import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import { RegistroRow } from '@domain/rdd';

let sheetsClient: sheets_v4.Sheets | null = null;

async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) {
    return sheetsClient;
  }

  const env = getEnv();
  const keyBuffer = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, 'base64');
  const keyJson = JSON.parse(keyBuffer.toString('utf-8'));

  const auth = new JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: keyJson.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export async function appendRegistroRow(row: RegistroRow): Promise<string> {
  const env = getEnv();
  const client = await getSheetsClient();

  const values = [
    [
      row.causaId,
      row.clienteNombre,
      row.clienteRut || '',
      row.demandado || '',
      row.rit || '',
      row.tribunal || '',
      row.driveFolderId,
      row.fechaIngreso,
    ],
  ];

  try {
    const result = await client.spreadsheets.values.append({
      spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: 'REGISTRO!A:H',
      valueInputOption: 'RAW',
      requestBody: { values },
    });

    const updatedRange = result.data.updates?.updatedRange || '';
    const match = updatedRange.match(/!([A-Z]+)(\d+)/);
    if (match) {
      return `${match[1]}${match[2]}`;
    }

    throw new Error(`Unable to parse row from Sheets response: ${updatedRange}`);
  } catch (error) {
    logger.error({ error, causaId: row.causaId }, 'appendRegistroRow failed');
    throw error;
  }
}
