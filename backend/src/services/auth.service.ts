import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.model';

const SALT_ROUNDS = 12;

export async function register(body: { name: string; email: string; password: string }) {
  const existing = await User.findOne({ email: body.email }).lean();
  if (existing) throw Object.assign(new Error('Email already in use'), { status: 409 });

  const hashed = await bcrypt.hash(body.password, SALT_ROUNDS);
  const user = await User.create({ name: body.name, email: body.email, password: hashed });
  return { id: user._id, email: user.email, name: user.name };
}

export async function login(body: { email: string; password: string }) {
  const user = await User.findOne({ email: body.email });
  if (!user) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const match = await bcrypt.compare(body.password, user.password);
  if (!match) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const token = jwt.sign({ sub: user._id, email: user.email }, process.env.JWT_SECRET!, {
    expiresIn: '7d'
  });
  return { token };
}
