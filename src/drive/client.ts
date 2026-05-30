import { google, drive_v3 } from 'googleapis';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import { retryWithBackoff } from '@utils/retry';
import { DRIVE_MIME_TYPES } from '@config/constants';

let driveClient: drive_v3.Drive | null = null;

/**
 * Obtener cliente Drive singleton.
 * Auth: GoogleAuth con service account credentials.
 */
async function getDriveClient(): Promise<drive_v3.Drive> {
  if (driveClient) {
    return driveClient;
  }

  const env = getEnv();

  try {
    const keyJson = JSON.parse(
      Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf-8')
    );

    const auth = new google.auth.GoogleAuth({
      credentials: keyJson,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    driveClient = google.drive({ version: 'v3', auth });
    logger.debug('Drive client initialized');
    return driveClient;
  } catch (error) {
    logger.error('Error initializing Drive client:', error);
    throw error;
  }
}

/**
 * Crear carpeta de caso en /Rodado/[causaId]/ con subcarpetas Por-Resolver y Resueltos.
 * Retorna IDs y webViewLink de la carpeta raíz.
 *
 * Cumple DI #6 (Rate Limiting) y DI #9 (Error Recovery) via retryWithBackoff.
 */
export async function createCaseFolder(causaId: string): Promise<{
  folderId: string;
  webViewLink: string;
  porResolverFolderId: string;
  resueltosFolderId: string;
}> {
  const drive = await getDriveClient();
  const env = getEnv();

  try {
    logger.debug({ causaId }, 'Creating Drive case folder structure');

    // 1. Crear carpeta raíz en /Rodado/[Causa_ID]/
    const rootFolderData = await retryWithBackoff(async () => {
      const res = await drive.files.create({
        requestBody: {
          name: causaId,
          mimeType: DRIVE_MIME_TYPES.FOLDER,
          parents: [env.GOOGLE_DRIVE_ROOT_FOLDER_ID],
        },
        fields: 'id, webViewLink',
      });
      return res.data;
    });

    const rootFolderId = rootFolderData.id!;
    const webViewLink = rootFolderData.webViewLink!;

    logger.debug({ causaId, rootFolderId }, 'Root case folder created');

    // 2. Crear subcarpetas Por-Resolver y Resueltos en paralelo
    const [porResolverData, resueltosData] = await Promise.all([
      retryWithBackoff(async () => {
        const res = await drive.files.create({
          requestBody: {
            name: 'Por-Resolver',
            mimeType: DRIVE_MIME_TYPES.FOLDER,
            parents: [rootFolderId],
          },
          fields: 'id',
        });
        return res.data;
      }),
      retryWithBackoff(async () => {
        const res = await drive.files.create({
          requestBody: {
            name: 'Resueltos',
            mimeType: DRIVE_MIME_TYPES.FOLDER,
            parents: [rootFolderId],
          },
          fields: 'id',
        });
        return res.data;
      }),
    ]);

    const porResolverFolderId = porResolverData.id!;
    const resueltosFolderId = resueltosData.id!;

    logger.info(
      { causaId, rootFolderId, porResolverFolderId, resueltosFolderId },
      'Case folder structure created successfully'
    );

    return {
      folderId: rootFolderId,
      webViewLink,
      porResolverFolderId,
      resueltosFolderId,
    };
  } catch (error) {
    logger.error({ causaId, error }, 'Error creating case folder');
    throw error;
  }
}

/**
 * Obtener información de carpeta de un caso.
 */
export async function getFoldersByCase(causaId: string): Promise<{
  rootId: string | null;
}> {
  const drive = await getDriveClient();
  const env = getEnv();

  try {
    const result = await retryWithBackoff(async () => {
      const res = await drive.files.list({
        q: `name='${causaId.replace(/'/g, "\\'")}' and mimeType='${DRIVE_MIME_TYPES.FOLDER}' and '${env.GOOGLE_DRIVE_ROOT_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive',
      });
      return res.data;
    });

    const folder = result.files?.[0];
    return { rootId: folder?.id ?? null };
  } catch (error) {
    logger.error({ causaId, error }, 'Error getting case folders');
    throw error;
  }
}

/**
 * Subir documento a una carpeta.
 */
export async function uploadDocument(
  parentFolderId: string,
  filename: string,
  content: Buffer,
  mimeType: string
): Promise<{ fileId: string; webViewLink: string }> {
  const drive = await getDriveClient();

  try {
    const result = await retryWithBackoff(async () => {
      const { Readable } = await import('stream');
      const stream = Readable.from(content);

      const res = await drive.files.create({
        requestBody: {
          name: filename,
          mimeType,
          parents: [parentFolderId],
        },
        media: {
          mimeType,
          body: stream,
        },
        fields: 'id, webViewLink',
      });
      return res.data;
    });

    logger.info({ filename, parentFolderId }, 'Document uploaded to Drive');

    return {
      fileId: result.id!,
      webViewLink: result.webViewLink!,
    };
  } catch (error) {
    logger.error({ filename, parentFolderId, error }, 'Error uploading document');
    throw error;
  }
}

/**
 * Listar documentos en una carpeta.
 */
export async function listDocuments(folderId: string): Promise<
  Array<{
    name: string;
    id: string;
    webViewLink: string;
  }>
> {
  const drive = await getDriveClient();

  try {
    const result = await retryWithBackoff(async () => {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, webViewLink)',
        spaces: 'drive',
      });
      return res.data;
    });

    return (
      result.files?.map(f => ({
        name: f.name!,
        id: f.id!,
        webViewLink: f.webViewLink!,
      })) ?? []
    );
  } catch (error) {
    logger.error({ folderId, error }, 'Error listing documents');
    throw error;
  }
}
