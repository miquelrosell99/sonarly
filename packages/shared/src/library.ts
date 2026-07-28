export interface Library {
  id: string;
  name: string;
  path: string;
  organizePattern: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLibraryInput {
  name: string;
  path: string;
  organizePattern?: string;
  isDefault?: boolean;
}

export interface UpdateLibraryInput {
  name?: string;
  path?: string;
  organizePattern?: string;
  isDefault?: boolean;
}
