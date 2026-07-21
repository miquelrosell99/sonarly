export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  isAdmin?: boolean;
}
