// mongo-init.js
db = db.getSiblingDB('myapp');

db.users.insertMany([
  {
    name: 'Harish',
    email: 'harish@example.com',
    password: '$2b$12$9TUuskMQBrujadriwB4rrexoALv.Zitt4aNPUBBnnKET68Hg6suiW', // cars
    updatedAt: new Date()
  }
]);