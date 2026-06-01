export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface User {
  _id: string;
  email: string;
  name: string;
  createdAt: string;
}
