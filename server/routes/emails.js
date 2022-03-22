const express = require('express');
const router = express.Router();
const Prisma = require('@prisma/client');
const prisma = new Prisma.PrismaClient();
const { quickAddJob } = require("graphile-worker");
require('dotenv').config();

router.post('/emails', async (req, res) => {
  const body = req.body;
  const owner = body.owner;

  // Collect data from webhook
  const data = {
    "from": body.from,
    "to": body.to,
    "cc": body.cc,
    "replyTo": body.replyTo,
    "labels": body.labels,
    "date": new Date(body.date),
    "threadId": body.threadId,
    "historyId": body.historyId,
    "messageId": body.messageId,
  };

  const participants = [].concat(data.from, data.to, data.cc || [], data.replyTo || []);

  _upsertMessage(data);

  participants.filter(p => p != owner).forEach(async (contact) => {
    _upsertConnection(data, owner, contact);
    _upsertPerson(contact);
    _enqueueEnrichmentJob(contact);
  })

  res.status(200).json({ message: `Processed new email: ${data.messageId}` });
});

const _upsertMessage = async (data) => { // Create message, only if new messageId
  await prisma.Message.upsert({
    where: { messageId: data.messageId },
    update: {},
    create: data
  })
  .then(res => { console.log('Message created: ', res) });
};

const _upsertConnection = async (data, owner, contact) => { // Create connection pair if doesn't exist, otherwise increment appropriate count
  const isFromOwner = data.from === owner;

  const existingMessage = await prisma.Message.findUnique({
    where: { messageId: data.messageId }
  }).then(res => res !== null);
  
  var updateData = { toAndFromOwner: { increment: 1 } };
    updateData[isFromOwner ? 'fromOwner' : 'toOwner'] = { increment: 1 };

    prisma.Connection.upsert({
      where: {
        owner_contact: { owner: owner, contact: contact },
      },
      update: existingMessage ? {} : updateData,
      create: {
        owner: owner,
        contact: contact,
        toOwner: isFromOwner ? 0 : 1,
        fromOwner: isFromOwner ? 1 : 0,
        toAndFromOwner: 1,
      },
    })
    .then(res => { console.log('Connection created/updated: ', res) });
}

const _upsertPerson = async (p) => { // Create person, only if new email
  await prisma.Person.upsert({
    where: { email: p },
    update: {},
    create: { email: p },
  })
  .then(res => { console.log('Person created: ', res) });
};

const _enqueueEnrichmentJob = async (email) => { // Enqueue enrichment job for async processing
  await quickAddJob(
    { connectionString: process.env['DATABASE_URL'] },
    'clearbitEnrichment',
    { email: email },
  );
};

module.exports = router;