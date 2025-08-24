import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { JiraService } from '../services/jira/JiraService';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/jira/test
 * Test JIRA connection
 */
router.post('/test', asyncHandler(async (req: Request, res: Response) => {
  const { jiraBaseUrl, jiraEmail, jiraToken } = req.body;

  if (!jiraBaseUrl || !jiraEmail || !jiraToken) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_CREDENTIALS',
        message: 'JIRA base URL, email, and token are required',
      },
    });
  }

  try {
    const jiraService = new JiraService({
      baseUrl: jiraBaseUrl,
      email: jiraEmail,
      token: jiraToken,
      projectKey: 'WIZ',
    });

    // Test basic connection
    const testResult = await jiraService.validateConnection();
    
    logger.info('JIRA connection test successful', { jiraBaseUrl });
    
    res.json({
      success: true,
      data: {
        message: 'JIRA connection successful',
        baseUrl: jiraBaseUrl,
        authenticated: true,
        testResult,
      },
    });
  } catch (error: any) {
    logger.error('JIRA connection test failed:', { 
      error: error.message,
      jiraBaseUrl,
      status: error.response?.status,
      statusText: error.response?.statusText 
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'JIRA_CONNECTION_FAILED',
        message: `JIRA connection failed: ${error.message}`,
        details: {
          baseUrl: jiraBaseUrl,
          status: error.response?.status,
          statusText: error.response?.statusText,
        },
      },
    });
  }
}));

/**
 * GET /api/jira/tickets
 * List JIRA tickets
 */
router.get('/tickets', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      tickets: [],
      message: 'JIRA ticket listing not implemented yet',
    },
  });
}));

export { router as jiraRoutes }; 