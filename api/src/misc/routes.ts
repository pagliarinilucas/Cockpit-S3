import { Elysia } from 'elysia';
import { authDerive, requireUser, requireAdmin } from '../auth/guard';

/**
 * Cluster stats and Garage native access keys live behind Garage's ADMIN API
 * (not the S3 API), which needs a separate admin token + integration. Until that
 * is wired, these return 501 so the UI shows an honest "not available" state
 * instead of fabricated data.
 */
export const miscRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .guard({ beforeHandle: requireUser }, (app) => app
    .get('/cluster', ({ set }) => { set.status = 501; return { error: 'not_implemented', hint: 'requires Garage admin API' }; })
    .get('/keys', ({ set }) => { set.status = 501; return { error: 'not_implemented', hint: 'requires Garage admin API' }; }),
  )
  .guard({ beforeHandle: requireAdmin }, (app) => app
    .post('/keys', ({ set }) => { set.status = 501; return { error: 'not_implemented' }; })
    .patch('/keys/:id/grants', ({ set }) => { set.status = 501; return { error: 'not_implemented' }; }),
  );
