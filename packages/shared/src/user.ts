export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  name?: string;
  surname?: string;
  email?: string;
  avatarUrl?: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  isAdmin?: boolean;
}

export interface UpdateProfileInput {
  name?: string;
  surname?: string;
  email?: string;
}
