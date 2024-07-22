const express = require('express');
const { OpenAI } = require('openai');
const { Sequelize, DataTypes } = require('sequelize');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

require('dotenv').config();

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const openai = new OpenAI(process.env.OPENAI_API_KEY);

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './database.sqlite'
});

const Conversation = sequelize.define('Conversation', {
  history: {
    type: DataTypes.TEXT,
    allowNull: false
  }
});

sequelize.sync();

async function getRooms() {
  try {
    const response = await axios.get('https://bot9assignement.deno.dev/rooms');
    return response.data;
  } catch (error) {
    console.error('Error fetching rooms:', error);
    throw error;
  }
}

async function bookRoom(roomId, fullName, email, nights) {
  try {
    const response = await axios.post('https://bot9assignement.deno.dev/book', {
      roomId,
      fullName,
      email,
      nights
    });
    return response.data;
  } catch (error) {
    console.error('Error booking room:', error);
    throw error;
  }
}

app.post('/chat', async (req, res) => {
  const { message, conversationId } = req.body;
  let conversation;

  try {
    if (conversationId) {
      conversation = await Conversation.findByPk(conversationId);
    }

    if (!conversation) {
      conversation = await Conversation.create({ history: '' });
    }

    const functions = [
      {
        name: 'get_rooms',
        description: 'Get available room options',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'book_room',
        description: 'Book a room',
        parameters: {
          type: 'object',
          properties: {
            roomId: { type: 'number' },
            fullName: { type: 'string' },
            email: { type: 'string' },
            nights: { type: 'number' }
          },
          required: ['roomId', 'fullName', 'email', 'nights']
        }
      }
    ];

    const messages = [
      { role: 'system', content: 'You are hotel booking bot .' },
      { role: 'user', content: conversation.history + '\n' + message }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-0613',
      messages: messages,
      functions: functions,
      function_call: 'auto'
    });

    let responseMessage = response.choices[0].message;

    if (responseMessage.function_call) {
      const functionName = responseMessage.function_call.name;
      const functionArgs = JSON.parse(responseMessage.function_call.arguments);

      let functionResult;
      if (functionName === 'get_rooms') {
        functionResult = await getRooms();
      } else if (functionName === 'book_room') {
        functionResult = await bookRoom(
          functionArgs.roomId,
          functionArgs.fullName,
          functionArgs.email,
          functionArgs.nights
        );
      }

      messages.push(responseMessage);
      messages.push({
        role: 'function',
        name: functionName,
        content: JSON.stringify(functionResult)
      });

      const secondResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0613',
        messages: messages
      });

      responseMessage = secondResponse.choices[0].message;
    }

    conversation.history += `User: ${message}\nAssistant: ${responseMessage.content}\n`;
    await conversation.save();

    res.json({
      response: responseMessage.content,
      conversationId: conversation.id
    });
  } catch (error) {
    console.error('Error processing chat:', error);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
