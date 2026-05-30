import { Request, Response } from 'express';
import { listConversations } from '@database/models';
import { getLogger } from '@utils/logger';

const logger = getLogger();

/**
 * Handler for GET /cases
 *
 * Lists all conversations (cases) available to the authenticated user.
 * Optionally filters to only open cases.
 *
 * Query Parameters:
 *   ?open=false → include closed cases (default: only open)
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       cases: [
 *         { causaId, status, createdAt, metadata },
 *         ...
 *       ],
 *       total: number
 *     },
 *     timestamp: ISO string
 *   }
 */
export async function casesHandler(req: Request, res: Response): Promise<void> {
  const onlyOpen = req.query.open !== 'false'; // default: only open cases

  try {
    const conversations = await listConversations({ onlyOpen, limit: 50 });

    res.json({
      success: true,
      data: {
        cases: conversations.map((c) => ({
          causaId: c.causa_id,
          status: c.closed_at ? 'closed' : 'active',
          createdAt: c.created_at.toISOString(),
          metadata: c.metadata,
        })),
        total: conversations.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error.message }, 'casesHandler: database error');
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Error listing cases',
      timestamp: new Date().toISOString(),
    });
  }
}
