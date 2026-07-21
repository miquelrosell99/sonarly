import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type Database from 'better-sqlite3';

export async function registerManagementRoutes(app: FastifyInstance, config: Config, db: Database.Database): Promise<void> {
  // TODO: implement management scan routes
}
