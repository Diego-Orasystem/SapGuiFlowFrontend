import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SftpService } from './sftp.service';

/**
 * Estructura de respuesta detallada del endpoint de posting dates
 */
export interface PostingDateDetail {
  table: string; // Nombre de la tabla (CJI3, KOB1, KSB1, MB51)
  cat_domain: string; // Dominio (CAN, CAS, etc.)
  last_posting_date: string; // Última fecha procesada (YYYY-MM-DD)
  missing_dates: string[]; // Array de fechas faltantes (YYYY-MM-DD)
  missing_count: number; // Cantidad de fechas faltantes
}

/**
 * Estructura de respuesta simple del endpoint de posting dates
 */
export interface PostingDateSimple {
  table: string;
  cat_domain: string;
  posting_dates: string[]; // Array de fechas faltantes
}

/**
 * Resumen de posting dates faltantes
 */
export interface PostingDatesSummary {
  total_packages_needed: number;
  by_table: { [table: string]: number };
  by_domain: { [domain: string]: number };
  details: PostingDateDetail[];
}

export interface ScheduledPackage {
  id: string;
  templateId: string;
  templateName: string;
  postingDate: string; // Fecha en formato YYYY-MM-DD
  status: 'pending' | 'scheduled' | 'executing' | 'completed' | 'error' | 'cancelled';
  scheduledAt: Date;
  executedAt?: Date;
  completedAt?: Date;
  error?: string;
  packageId?: string; // ID del paquete generado
  executionLog?: string[];
}

export interface ScheduleExecutionResult {
  success: boolean;
  message: string;
  scheduledPackages: ScheduledPackage[];
  totalPackages: number;
  completedPackages: number;
  errorPackages: number;
  pendingPackages: number;
}

@Injectable({
  providedIn: 'root'
})
export class SchedulerService {
  private apiUrl = 'http://localhost:3000/api/scheduler'; // Ajustar según la configuración del backend

  constructor(
    private http: HttpClient,
    private sftpService: SftpService
  ) { }

  /**
   * Obtiene los posting dates faltantes desde la API
   * Esta API consulta hasta cuál fue el último día que la base de datos tiene actualizado
   * y retorna los posting dates individuales de los días que faltan
   * 
   * @param tables Opcional: String separado por comas con los nombres de las tablas (ej: "CJI3,KSB1")
   * @param format Opcional: "detailed" | "simple" (por defecto: "detailed")
   */
  getPendingPostingDates(
    tables?: string,
    format: 'detailed' | 'simple' = 'detailed'
  ): Observable<PostingDateDetail[] | PostingDateSimple[]> {
    const headers = this.getHeaders();
    let params = new HttpParams();
    
    if (tables) {
      params = params.set('tables', tables);
    }
    if (format) {
      params = params.set('format', format);
    }

    return this.http.get<PostingDateDetail[] | PostingDateSimple[]>(
      `${this.apiUrl}/posting-dates`,
      { headers, params }
    ).pipe(
      catchError((error) => {
        console.warn('API de posting dates no disponible, usando datos de ejemplo:', error);
        // Retornar datos de ejemplo para desarrollo
        return of(this.getMockPostingDates(format));
      })
    );
  }

  /**
   * Obtiene un resumen de los posting dates faltantes
   * 
   * @param tables Opcional: String separado por comas con los nombres de las tablas
   */
  getPostingDatesSummary(tables?: string): Observable<PostingDatesSummary> {
    const headers = this.getHeaders();
    let params = new HttpParams();
    
    if (tables) {
      params = params.set('tables', tables);
    }

    return this.http.get<PostingDatesSummary>(
      `${this.apiUrl}/posting-dates/summary`,
      { headers, params }
    ).pipe(
      catchError((error) => {
        console.warn('API de posting dates summary no disponible, usando datos de ejemplo:', error);
        return of(this.getMockSummary());
      })
    );
  }

  /**
   * Obtiene todas las fechas faltantes únicas de todas las tablas
   * Útil para crear paquetes sin duplicar fechas
   */
  getAllUniqueMissingDates(tables?: string): Observable<string[]> {
    return this.getPendingPostingDates(tables, 'detailed').pipe(
      map((response) => {
        if (Array.isArray(response) && response.length > 0) {
          const allDates = new Set<string>();
          response.forEach((item) => {
            // Verificar si es PostingDateDetail (tiene missing_dates)
            if ('missing_dates' in item && Array.isArray(item.missing_dates)) {
              const detailItem = item as PostingDateDetail;
              detailItem.missing_dates.forEach(date => allDates.add(date));
            }
            // Si es PostingDateSimple (tiene posting_dates)
            else if ('posting_dates' in item && Array.isArray(item.posting_dates)) {
              const simpleItem = item as PostingDateSimple;
              simpleItem.posting_dates.forEach(date => allDates.add(date));
            }
          });
          return Array.from(allDates).sort();
        }
        return [];
      })
    );
  }

  /**
   * Genera un paquete de sincronización para una fecha específica basado en una plantilla
   */
  generatePackageForDate(templateId: string, templateData: any, postingDate: string): Observable<any> {
    // Esta función debería generar el paquete similar a como lo hace sync-packages
    // Por ahora retornamos un observable con los datos del paquete generado
    return of({
      id: this.generatePackageId(),
      templateId: templateId,
      postingDate: postingDate,
      packageData: this.applyDateToTemplate(templateData, postingDate),
      generatedAt: new Date()
    });
  }

  /**
   * Programa la ejecución automática de paquetes para múltiples fechas
   */
  schedulePackagesExecution(
    templateId: string,
    templateData: any,
    postingDates: string[]
  ): Observable<ScheduleExecutionResult> {
    const scheduledPackages: ScheduledPackage[] = postingDates.map(date => ({
      id: this.generateScheduleId(),
      templateId: templateId,
      templateName: templateData.name || 'Plantilla sin nombre',
      postingDate: date,
      status: 'pending',
      scheduledAt: new Date()
    }));

    return of({
      success: true,
      message: `Se programaron ${scheduledPackages.length} paquetes para ejecución`,
      scheduledPackages: scheduledPackages,
      totalPackages: scheduledPackages.length,
      completedPackages: 0,
      errorPackages: 0,
      pendingPackages: scheduledPackages.length
    });
  }

  /**
   * Ejecuta un paquete programado
   */
  executeScheduledPackage(scheduledPackage: ScheduledPackage, templateData: any): Observable<any> {
    // Cambiar estado a ejecutando
    scheduledPackage.status = 'executing';
    scheduledPackage.executedAt = new Date();

    // Generar el paquete para la fecha específica
    return this.generatePackageForDate(
      scheduledPackage.templateId,
      templateData,
      scheduledPackage.postingDate
    ).pipe(
      map((packageData) => {
        // Aquí se debería guardar el paquete en SFTP y ejecutarlo
        scheduledPackage.packageId = packageData.id;
        scheduledPackage.status = 'completed';
        scheduledPackage.completedAt = new Date();
        return scheduledPackage;
      }),
      catchError((error) => {
        scheduledPackage.status = 'error';
        scheduledPackage.error = error.message || 'Error desconocido al ejecutar el paquete';
        return of(scheduledPackage);
      })
    );
  }

  /**
   * Cancela la ejecución de un paquete programado
   */
  cancelScheduledPackage(scheduledPackage: ScheduledPackage): void {
    if (scheduledPackage.status === 'pending' || scheduledPackage.status === 'scheduled') {
      scheduledPackage.status = 'cancelled';
    }
  }

  /**
   * Obtiene el estado de todos los paquetes programados
   */
  getScheduledPackagesStatus(scheduledPackages: ScheduledPackage[]): {
    total: number;
    pending: number;
    executing: number;
    completed: number;
    error: number;
    cancelled: number;
  } {
    return {
      total: scheduledPackages.length,
      pending: scheduledPackages.filter(p => p.status === 'pending').length,
      executing: scheduledPackages.filter(p => p.status === 'executing').length,
      completed: scheduledPackages.filter(p => p.status === 'completed').length,
      error: scheduledPackages.filter(p => p.status === 'error').length,
      cancelled: scheduledPackages.filter(p => p.status === 'cancelled').length
    };
  }

  /**
   * Aplica la fecha a una plantilla (similar a applyDatesAndDefaults en sync-packages)
   */
  private applyDateToTemplate(templateData: any, postingDate: string): any {
    // Esta lógica debería ser similar a la de sync-packages
    // Por ahora retornamos una copia de la plantilla con la fecha aplicada
    const packageData = JSON.parse(JSON.stringify(templateData));
    
    // Aplicar fecha según el tipo de plantilla
    if (packageData.type === 'SUMMARY_SYNC') {
      // Formato YYYYMM
      const date = new Date(postingDate);
      const formattedDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
      // Aplicar fecha a los forms
      if (packageData.forms) {
        packageData.forms.forEach((form: any) => {
          if (form.jsonData) {
            form.jsonData.startDate = formattedDate;
          }
        });
      }
    } else if (packageData.type === 'DETAILS_SYNC') {
      // Formato DD.MM.YYYY
      const date = new Date(postingDate);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      const formattedDate = `${day}.${month}.${year}`;
      // Aplicar fecha a los forms
      if (packageData.forms) {
        packageData.forms.forEach((form: any) => {
          if (form.jsonData) {
            form.jsonData.startDate = formattedDate;
          }
        });
      }
    }

    return packageData;
  }

  /**
   * Genera un ID único para un paquete programado
   */
  private generateScheduleId(): string {
    return `SCHED_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  /**
   * Genera un ID único para un paquete
   */
  private generatePackageId(): string {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  /**
   * Obtiene los headers HTTP con la API Key
   */
  private getHeaders(): HttpHeaders {
    const apiKey = localStorage.getItem('apiKey') || '';
    return new HttpHeaders({
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    });
  }

  /**
   * Retorna datos de ejemplo para desarrollo (mock)
   */
  private getMockPostingDates(format: 'detailed' | 'simple' = 'detailed'): PostingDateDetail[] | PostingDateSimple[] {
    const today = new Date();
    const missingDates: string[] = [];
    
    // Generar fechas de los últimos 7 días que faltan procesar
    for (let i = 1; i <= 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      missingDates.push(date.toISOString().split('T')[0]);
    }

    const lastProcessedDate = new Date(today);
    lastProcessedDate.setDate(lastProcessedDate.getDate() - 8);

    if (format === 'simple') {
      return [
        {
          table: 'CJI3',
          cat_domain: 'CAN',
          posting_dates: missingDates
        },
        {
          table: 'KSB1',
          cat_domain: 'CAS',
          posting_dates: missingDates.slice(0, 5)
        }
      ];
    }

    return [
      {
        table: 'CJI3',
        cat_domain: 'CAN',
        last_posting_date: lastProcessedDate.toISOString().split('T')[0],
        missing_dates: missingDates,
        missing_count: missingDates.length
      },
      {
        table: 'KSB1',
        cat_domain: 'CAS',
        last_posting_date: lastProcessedDate.toISOString().split('T')[0],
        missing_dates: missingDates.slice(0, 5),
        missing_count: 5
      },
      {
        table: 'KOB1',
        cat_domain: 'CAN',
        last_posting_date: lastProcessedDate.toISOString().split('T')[0],
        missing_dates: missingDates.slice(0, 3),
        missing_count: 3
      }
    ];
  }

  /**
   * Retorna un resumen de ejemplo para desarrollo (mock)
   */
  private getMockSummary(): PostingDatesSummary {
    const mockDetails = this.getMockPostingDates('detailed') as PostingDateDetail[];
    
    let totalPackages = 0;
    const byTable: { [table: string]: number } = {};
    const byDomain: { [domain: string]: number } = {};

    mockDetails.forEach(item => {
      totalPackages += item.missing_count;
      byTable[item.table] = (byTable[item.table] || 0) + item.missing_count;
      byDomain[item.cat_domain] = (byDomain[item.cat_domain] || 0) + item.missing_count;
    });

    return {
      total_packages_needed: totalPackages,
      by_table: byTable,
      by_domain: byDomain,
      details: mockDetails
    };
  }
}

