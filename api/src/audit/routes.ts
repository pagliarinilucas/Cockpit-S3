import { Elysia } from 'elysia';
import { authDerive, requireUser } from '../auth/guard';
import { audit } from './store';

export const activityRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .guard({ beforeHandle: requireUser }, (app) =>
    app.get('/activity', () => audit.list()),
  );
