import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

/**
 * GET /api/repositories
 * List repositories
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      repositories: [],
      message: 'Repository listing not implemented yet',
    },
  });
}));

export { router as repositoryRoutes }; 