import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/error.middleware';
import router from './routes/index.route';

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:4200' }));
app.use(express.json());

app.use('/api', router);
app.use(errorHandler);

export default app;
