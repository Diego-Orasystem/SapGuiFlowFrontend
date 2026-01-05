import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SftpService, SftpFile } from '../../services/sftp.service';
import { SchedulerService, PostingDateDetail, PostingDateSimple, PostingDatesSummary, ScheduledPackage } from '../../services/scheduler.service';

// Exportar tipos para uso en template
export type { PostingDateDetail, PostingDateSimple, PostingDatesSummary };

interface SyncTemplate {
  id: string;
  name: string;
  type: 'SUMMARY_SYNC' | 'DETAILS_SYNC' | 'CUSTOM';
  forms: any[];
}

interface ExecutionLog {
  timestamp: Date;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  packageId?: string;
  postingDate?: string;
  data?: any;
}

@Component({
  selector: 'app-scheduler',
  templateUrl: './scheduler.component.html',
  styleUrls: ['./scheduler.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class SchedulerComponent implements OnInit {
  private readonly TEMPLATES_DIRECTORY = 'sap-query-package';
  private readonly QUERIES_DIRECTORY = 'sap-queries'; // Directorio donde se guardan los archivos .sqpr

  // Plantillas disponibles
  availableTemplates: SftpFile[] = [];
  loadingTemplates = false;
  selectedTemplate: SftpFile | null = null;
  selectedTemplateData: SyncTemplate | null = null;

  // Posting dates
  postingDatesData: PostingDateSimple[] = [];
  postingDatesSummary: PostingDatesSummary | null = null;
  loadingPostingDates = false;
  pendingPostingDates: string[] = []; // Todas las fechas únicas faltantes
  selectedTables: string = ''; // Tablas seleccionadas (separadas por comas)

  // Paquetes por posting_date (pestañas)
  datePackages: Array<{
    id: string;
    postingDate: string;
    forms: Array<{
      id: string;
      formId: string;
      formName: string;
      tcode: string;
      fileName: string;
      formData: any;
      originalFormData: any; // Datos originales de la plantilla
    }>;
  }> = [];
  currentDatePackageId: string | null = null;
  currentFormId: string | null = null;

  // Estado de guardado
  isSaving = false;
  savedFiles: string[] = []; // Archivos guardados exitosamente
  failedFiles: string[] = []; // Archivos que fallaron

  // Panel de ejecución y logs
  showExecutionPanel = false;
  executionLogs: ExecutionLog[] = [];


  // Sección de desarrollo - Prueba de APIs
  showDevSection = false;
  devApiParams = {
    tables: '',
    format: 'detailed' as 'detailed' | 'simple',
    summaryTables: ''
  };
  devApiLoading = {
    postingDates: false,
    summary: false
  };
  devApiResults: {
    postingDates: any;
    summary: any;
  } = {
    postingDates: null,
    summary: null
  };

  constructor(
    private sftpService: SftpService,
    private schedulerService: SchedulerService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadTemplates();
    this.loadPendingPostingDates();
  }

  /**
   * Carga las plantillas disponibles desde SFTP
   */
  loadTemplates(): void {
    this.loadingTemplates = true;
    this.availableTemplates = [];

    this.sftpService.listPackages(this.TEMPLATES_DIRECTORY).subscribe({
      next: (response) => {
        this.loadingTemplates = false;
        if (response.status && response.files) {
          this.availableTemplates = response.files.filter(file => 
            !file.isDirectory && file.name.endsWith('.json')
          );
        } else {
          this.addLog('error', 'Error al cargar plantillas: ' + (response.message || 'Error desconocido'));
        }
      },
      error: (error) => {
        this.loadingTemplates = false;
        this.addLog('error', 'Error al cargar plantillas desde SFTP: ' + error.message);
      }
    });
  }

  /**
   * Maneja el cambio de selección de plantilla
   */
  onTemplateChange(template: SftpFile | null): void {
    if (template) {
      this.selectTemplate(template);
    } else {
      this.selectedTemplate = null;
      this.selectedTemplateData = null;
    }
  }

  /**
   * Selecciona una plantilla y carga su contenido
   */
  selectTemplate(template: SftpFile): void {
    this.selectedTemplate = template;
    this.selectedTemplateData = null;
    this.loadingTemplates = true;

    this.sftpService.getJsonFileContent(template.path).subscribe({
      next: (response) => {
        this.loadingTemplates = false;
        if (response.status && response.content) {
          try {
            const templateData = JSON.parse(response.content);
            this.selectedTemplateData = {
              id: template.name.replace('.json', ''),
              name: templateData.name || template.name,
              type: templateData.type || 'CUSTOM',
              forms: templateData.forms || []
            };
            this.addLog('success', `Plantilla "${this.selectedTemplateData.name}" cargada correctamente`);
          } catch (error) {
            this.addLog('error', 'Error al parsear la plantilla: ' + (error as Error).message);
          }
        } else {
          this.addLog('error', 'Error al cargar la plantilla: ' + (response.message || 'Error desconocido'));
        }
      },
      error: (error) => {
        this.loadingTemplates = false;
        this.addLog('error', 'Error al cargar plantilla desde SFTP: ' + error.message);
      }
    });
  }

  /**
   * Carga los posting dates pendientes desde la API
   */
  loadPendingPostingDates(): void {
    this.loadingPostingDates = true;
    this.postingDatesData = [];
    this.pendingPostingDates = [];

    // Obtener todas las fechas únicas faltantes
    this.schedulerService.getAllUniqueMissingDates(
      this.selectedTables || undefined
    ).subscribe({
      next: (dates) => {
        this.pendingPostingDates = dates;
        this.addLog('info', `Se encontraron ${this.pendingPostingDates.length} días únicos pendientes de procesar`);
      },
      error: (error) => {
        this.addLog('error', 'Error al obtener fechas únicas: ' + error.message);
      }
    });

    // Obtener datos en formato simple
    this.schedulerService.getPendingPostingDates(
      this.selectedTables || undefined,
      'simple'
    ).subscribe({
      next: (response) => {
        this.loadingPostingDates = false;
        this.postingDatesData = response as PostingDateSimple[];
        this.addLog('success', `Se cargaron ${this.postingDatesData.length} tablas`);
      },
      error: (error) => {
        this.loadingPostingDates = false;
        this.addLog('error', 'Error al cargar posting dates: ' + error.message);
      }
    });

    // Obtener resumen
    this.schedulerService.getPostingDatesSummary(
      this.selectedTables || undefined
    ).subscribe({
      next: (summary) => {
        this.postingDatesSummary = summary;
        this.addLog('info', `Resumen: ${summary.total_packages_needed} paquetes necesarios en total`);
      },
      error: (error) => {
        this.addLog('warning', 'No se pudo cargar el resumen: ' + error.message);
      }
    });
  }

  /**
   * Crea pestañas automáticamente para cada posting_date
   */
  createDatePackages(): void {
    if (!this.selectedTemplateData || this.pendingPostingDates.length === 0) {
      this.addLog('warning', 'Debe seleccionar una plantilla y tener fechas pendientes');
      return;
    }

    // Limpiar pestañas existentes
    this.datePackages = [];
    this.currentDatePackageId = null;
    this.currentFormId = null;

    // Crear una pestaña por cada posting_date
    this.pendingPostingDates.forEach(postingDate => {
      const packageId = this.generateScheduleId();
      const forms: Array<{
        id: string;
        formId: string;
        formName: string;
        tcode: string;
        fileName: string;
        formData: any;
        originalFormData: any;
      }> = [];

      // Crear un archivo .sqpr por cada formulario en la plantilla
      this.selectedTemplateData.forms.forEach((form: any, index: number) => {
        const tcodeForFile = this.getTcodeForFileName(form.customName, form.tcode);
        const fileName = this.generateSqprFileName(tcodeForFile, postingDate, this.getPeriodType());
        
        // Aplicar fecha al formulario
        const formDataWithDates = this.applyDatesToForm(
          form.jsonData || {},
          postingDate,
          form.tcode,
          form.customName
        );

        forms.push({
          id: `form_${packageId}_${index}`,
          formId: form.id || `form_${index}`,
          formName: form.customName,
          tcode: form.tcode,
          fileName: fileName,
          formData: JSON.parse(JSON.stringify(formDataWithDates)), // Copia profunda para edición
          originalFormData: JSON.parse(JSON.stringify(formDataWithDates))
        });
      });

      // Agregar formDataJson para el editor
      forms.forEach(form => {
        (form as any).formDataJson = JSON.stringify(form.formData, null, 2);
      });

      this.datePackages.push({
        id: packageId,
        postingDate: postingDate,
        forms: forms
      });
    });

    // Seleccionar la primera pestaña
    if (this.datePackages.length > 0) {
      this.selectDatePackage(this.datePackages[0].id);
    }

    this.addLog('success', `Se crearon ${this.datePackages.length} pestañas para previsualizar y editar`);
  }

  /**
   * Selecciona una pestaña de posting_date
   */
  selectDatePackage(packageId: string): void {
    this.currentDatePackageId = packageId;
    const pkg = this.getCurrentDatePackage();
    if (pkg && pkg.forms.length > 0) {
      this.currentFormId = pkg.forms[0].id;
    }
  }

  /**
   * Obtiene el paquete de fecha actual
   */
  getCurrentDatePackage(): { id: string; postingDate: string; forms: any[] } | null {
    if (!this.currentDatePackageId) return null;
    return this.datePackages.find(p => p.id === this.currentDatePackageId) || null;
  }

  /**
   * Obtiene el formulario actual
   */
  getCurrentForm(): any {
    const pkg = this.getCurrentDatePackage();
    if (!pkg || !this.currentFormId) return null;
    return pkg.forms.find(f => f.id === this.currentFormId) || null;
  }

  /**
   * Selecciona un formulario dentro de la pestaña actual
   */
  selectForm(formId: string): void {
    this.currentFormId = formId;
  }

  /**
   * Guarda todos los archivos .sqpr de todas las pestañas
   */
  saveAllFiles(): void {
    if (this.datePackages.length === 0) {
      this.addLog('warning', 'No hay archivos para guardar');
      return;
    }

    if (this.isSaving) {
      this.addLog('warning', 'Ya hay un guardado en curso');
      return;
    }

    this.isSaving = true;
    this.savedFiles = [];
    this.failedFiles = [];
    this.showExecutionPanel = true;
    this.addLog('info', `Iniciando guardado de archivos .sqpr`);

    let totalFiles = 0;
    let savedCount = 0;
    let failedCount = 0;

    // Contar total de archivos
    this.datePackages.forEach(pkg => {
      totalFiles += pkg.forms.length;
    });

    this.addLog('info', `Total de archivos a guardar: ${totalFiles}`);

    // Guardar cada archivo
    this.datePackages.forEach((pkg, pkgIndex) => {
      pkg.forms.forEach((form, formIndex) => {
        this.sftpService.savePackageToSftp(
          form.fileName,
          form.formData,
          false,
          this.QUERIES_DIRECTORY
        ).subscribe({
          next: (response) => {
            if (response.status) {
              savedCount++;
              const actualFileName = response.fileName || form.fileName;
              this.savedFiles.push(actualFileName);
              this.addLog('success', `✓ ${form.formName} (${pkg.postingDate}) guardado como ${actualFileName}`);
            } else {
              failedCount++;
              this.failedFiles.push(form.fileName);
              this.addLog('error', `✗ Error al guardar ${form.formName}: ${response.message}`);
            }

            // Si se guardaron todos los archivos
            if (savedCount + failedCount === totalFiles) {
              this.finishSaving(savedCount, failedCount);
            }
          },
          error: (error) => {
            failedCount++;
            this.failedFiles.push(form.fileName);
            this.addLog('error', `Error al guardar ${form.formName}: ${error.message}`);

            // Si se guardaron todos los archivos
            if (savedCount + failedCount === totalFiles) {
              this.finishSaving(savedCount, failedCount);
            }
          }
        });
      });
    });
  }

  /**
   * Finaliza el proceso de guardado
   */
  private finishSaving(savedCount: number, failedCount: number): void {
    this.isSaving = false;
    
    if (savedCount > 0) {
      this.addLog('success', `✓ Se guardaron exitosamente ${savedCount} archivo(s) .sqpr`);
      this.addLog('info', `Archivos guardados en: ~/lek-files-dev/can/sap-queries$`);
    }
    
    if (failedCount > 0) {
      this.addLog('error', `✗ ${failedCount} archivo(s) fallaron durante el guardado`);
    }
  }

  /**
   * Maneja el cambio en el editor JSON del formulario
   */
  onFormDataChange(formId: string, jsonString: string): void {
    // Buscar el formulario en todas las pestañas
    for (const pkg of this.datePackages) {
      const form = pkg.forms.find(f => f.id === formId);
      if (form) {
        try {
          const parsed = JSON.parse(jsonString);
          form.formData = parsed;
          (form as any).formDataJson = jsonString; // Mantener el string formateado
          this.cdr.detectChanges();
        } catch (error) {
          // JSON inválido, mantener el string pero no actualizar formData
          (form as any).formDataJson = jsonString;
          console.warn('JSON inválido:', error);
        }
        break;
      }
    }
  }

  /**
   * Restaura los datos originales de un formulario
   */
  resetFormData(formId: string): void {
    const form = this.getCurrentForm();
    if (form && form.id === formId) {
      form.formData = JSON.parse(JSON.stringify(form.originalFormData));
      form.formDataJson = JSON.stringify(form.formData, null, 2);
      this.cdr.detectChanges();
      this.addLog('info', `Datos de ${form.formName} restaurados a los valores originales`);
    }
  }

  /**
   * Agrega un log de ejecución
   */
  private addLog(type: 'info' | 'warning' | 'error' | 'success', message: string, data?: any): void {
    this.executionLogs.push({
      timestamp: new Date(),
      type: type,
      message: message,
      data: data
    });
  }

  /**
   * Limpia los logs de ejecución
   */
  clearLogs(): void {
    this.executionLogs = [];
  }

  /**
   * Exporta los logs de ejecución
   */
  exportLogs(): void {
    const logsText = this.executionLogs.map(log => {
      return `[${log.timestamp.toISOString()}] [${log.type.toUpperCase()}] ${log.message}`;
    }).join('\n');

    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scheduler-logs-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  /**
   * Obtiene el total de archivos a guardar
   */
  getTotalFilesCount(): number {
    return this.datePackages.reduce((total, pkg) => total + pkg.forms.length, 0);
  }


  /**
   * Toggle del panel de ejecución
   */
  toggleExecutionPanel(): void {
    this.showExecutionPanel = !this.showExecutionPanel;
  }

  /**
   * Formatea una fecha para mostrar
   */
  formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    } catch {
      return dateString;
    }
  }

  /**
   * Obtiene las claves de un objeto para iterar en el template
   */
  getTableKeys(obj: { [key: string]: number } | null | undefined): string[] {
    if (!obj) return [];
    return Object.keys(obj);
  }


  /**
   * Genera un ID único para un paquete programado
   */
  private generateScheduleId(): string {
    return `SCHED_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  /**
   * Genera un ID hexadecimal único (8 caracteres)
   */
  private generateHexId(): string {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  /**
   * Genera el nombre del archivo en el formato: ID_HEX-TCODE@startDate=FECHA.sqpr
   */
  private generateSqprFileName(tcode: string, postingDate: string, periodType: 'month' | 'day'): string {
    let formattedDate: string;
    
    if (tcode === 'ZFIR_STATLOAD' || tcode === 'ZFIR_STATSLOAD') {
      // Para ZFIR_STATSLOAD: formato YYYYMM
      formattedDate = this.formatDateForSummarySync(postingDate);
    } else {
      // Para KSB1, KOB1, CJI3: formato DD.MM.YYYY
      formattedDate = this.formatDateForDetailsSync(postingDate);
    }
    
    const hexId = this.generateHexId();
    return `${hexId}-${tcode}@startDate=${formattedDate}.sqpr`;
  }

  /**
   * Formatea la fecha para DETAILS_SYNC (DD.MM.YYYY)
   */
  private formatDateForDetailsSync(date: Date | string): string {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  }

  /**
   * Formatea la fecha para SUMMARY_SYNC (YYYYMM)
   */
  private formatDateForSummarySync(date: Date | string): string {
    const d = new Date(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${year}${month}`;
  }

  /**
   * Convierte el customName a formato TCode para el nombre del archivo
   */
  private getTcodeForFileName(customName: string, tcode: string): string {
    const customNameUpper = customName.toUpperCase();
    
    if (customNameUpper.includes('KSB1')) {
      return 'KSB1';
    } else if (customNameUpper.includes('KOB1')) {
      return 'KOB1';
    } else if (customNameUpper.includes('CJI3') && customNameUpper.includes('ALLCOST')) {
      return 'CJI3#ALLCOST';
    } else if (customNameUpper.includes('CJI3') && customNameUpper.includes('CANDALL')) {
      return 'CJI3#1CANDALL';
    } else if (customNameUpper.includes('ZFIR_STATSLOAD') || tcode === 'ZFIR_STATLOAD') {
      return 'ZFIR_STATSLOAD';
    }
    
    return tcode || customName;
  }

  /**
   * Determina el tipo de período basado en el tipo de plantilla
   */
  private getPeriodType(): 'month' | 'day' {
    if (this.selectedTemplateData?.type === 'SUMMARY_SYNC') {
      return 'month';
    }
    return 'day';
  }

  /**
   * Aplica la fecha de posting_date al formulario
   */
  private applyDatesToForm(formData: any, postingDate: string, tcode: string, customName: string): any {
    const updatedData: any = { ...formData };
    
    // Determinar formato de fecha según el tipo de formulario
    const isCJI3 = customName.includes('CJI3');
    const isKOB1 = tcode === 'KOB1';
    const isKSB1 = tcode === 'KSB1';
    const needsDDMMYYYY = isCJI3 || isKOB1 || isKSB1;
    
    const dateFormat = needsDDMMYYYY 
      ? this.formatDateForDetailsSync(postingDate)
      : this.formatDateForSummarySync(postingDate);
    
    // Aplicar fecha de posting date
    Object.keys(updatedData).forEach(key => {
      const keyLower = key.toLowerCase();
      
      // Buscar variaciones de "Posting date LOW" o "startDate"
      if ((keyLower.includes('posting') && keyLower.includes('low')) ||
          (keyLower.includes('budat') && keyLower.includes('low')) ||
          keyLower === 'startdate') {
        updatedData[key] = dateFormat;
      }
    });
    
    // Si no existe startDate, agregarlo
    if (!updatedData.startDate) {
      updatedData.startDate = dateFormat;
    }
    
    return updatedData;
  }

  /**
   * Toggle de la sección de desarrollo
   */
  toggleDevSection(): void {
    this.showDevSection = !this.showDevSection;
  }

  /**
   * Prueba el endpoint de posting dates
   */
  testPostingDatesApi(): void {
    this.devApiLoading.postingDates = true;
    this.devApiResults.postingDates = null;

    this.schedulerService.getPendingPostingDates(
      this.devApiParams.tables || undefined,
      'simple'
    ).subscribe({
      next: (response) => {
        this.devApiLoading.postingDates = false;
        this.devApiResults.postingDates = response;
        this.addLog('success', 'API de posting dates probada exitosamente');
      },
      error: (error) => {
        this.devApiLoading.postingDates = false;
        this.devApiResults.postingDates = {
          error: error.message || 'Error desconocido',
          status: error.status || 'N/A',
          statusText: error.statusText || 'N/A'
        };
        this.addLog('error', 'Error al probar API de posting dates: ' + error.message);
      }
    });
  }

  /**
   * Prueba el endpoint de summary
   */
  testSummaryApi(): void {
    this.devApiLoading.summary = true;
    this.devApiResults.summary = null;

    this.schedulerService.getPostingDatesSummary(
      this.devApiParams.summaryTables || undefined
    ).subscribe({
      next: (response) => {
        this.devApiLoading.summary = false;
        this.devApiResults.summary = response;
        this.addLog('success', 'API de summary probada exitosamente');
      },
      error: (error) => {
        this.devApiLoading.summary = false;
        this.devApiResults.summary = {
          error: error.message || 'Error desconocido',
          status: error.status || 'N/A',
          statusText: error.statusText || 'N/A'
        };
        this.addLog('error', 'Error al probar API de summary: ' + error.message);
      }
    });
  }

  /**
   * Formatea JSON para mostrar en el preview
   */
  formatJson(obj: any): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  /**
   * Copia texto al portapapeles
   */
  copyToClipboard(text: any): void {
    const jsonString = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    navigator.clipboard.writeText(jsonString).then(() => {
      this.addLog('success', 'JSON copiado al portapapeles');
    }).catch(err => {
      this.addLog('error', 'Error al copiar al portapapeles: ' + err.message);
    });
  }

  /**
   * Limpia los resultados de las pruebas de API
   */
  clearDevResults(): void {
    this.devApiResults = {
      postingDates: null,
      summary: null
    };
    this.addLog('info', 'Resultados de pruebas limpiados');
  }
}

