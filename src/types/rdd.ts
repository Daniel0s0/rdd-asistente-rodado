export interface CausaWebhookPayload {
  causa_id: string;
  cliente_id?: string;
  cliente_nombre: string;
  cliente_rut?: string;
  drive_folder_id?: string;
  demandado?: string;
  rit?: string;
  tribunal?: string;
}

export interface CasoModificacionPayload {
  causa_id: string;
  rit?: string;
  tribunal?: string;
  cambios?: Record<string, unknown>;
  timestamp?: string;
}

export interface CasoCierrePayload {
  causa_id: string;
  fecha_cierre?: string;
  motivo?: string;
  timestamp?: string;
}

export interface RegistroRow {
  causaId: string;
  clienteNombre: string;
  clienteRut?: string;
  demandado?: string;
  rit?: string;
  tribunal?: string;
  driveFolderId: string;
  driveFolderUrl?: string;
  fechaIngreso: string;
}
