import { Component, OnInit, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SftpService, SftpFile } from '../../services/sftp.service';
import { DateRangeModalComponent, DateRange } from '../date-range-modal/date-range-modal.component';
import { SyncPackageValidatorService, PackageValidationResult, ExecutionStep, ExecutionLog } from '../../services/sync-package-validator.service';

interface Package {
  id: string;
  name: string;
  forms: Form[];
}

interface Form {
  id: string;
  tcode: string;
  customName: string;
  jsonData: any;
  parameters: string[];
}

@Component({
  selector: 'app-sync-packages',
  templateUrl: './sync-packages.component.html',
  styleUrls: ['./sync-packages.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, DateRangeModalComponent]
})
export class SyncPackagesComponent implements OnInit, AfterViewInit {
  // Directorio donde se guardan los paquetes de sincronización (instancias finales con fechas)
  // Ubicación: ~/lek-files-dev/can/sap-queries$
  // IMPORTANTE: Este es el directorio para PAQUETES DE SINCRONIZACIÓN, NO para plantillas
  private readonly QUERIES_DIRECTORY = 'sap-queries'; // Directorio: ~/lek-files-dev/can/sap-queries$
  
  // Directorio donde están las plantillas guardadas (solo para lectura, NO para guardar)
  // Ubicación: ~/lek-files-dev/can/sap-config/sap-query-package
  private readonly TEMPLATES_DIRECTORY = 'sap-query-package'; // Directorio: ~/lek-files-dev/can/sap-config/sap-query-package
  
  /**
   * Genera un ID hexadecimal único (8 caracteres)
   */
  private generateHexId(): string {
    // Generar 4 bytes aleatorios (8 caracteres hex)
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  
  /**
   * Genera el nombre del archivo en el formato: ID_HEX-TCODE@startDate=FECHA.sqpr
   * Nota: El sufijo "-dwld" lo agrega el motor automáticamente, no debe incluirse aquí.
   * @param tcode El código de transacción (ej: KSB1, KOB1, ZFIR_STATSLOAD, CJI3#1CANDALL, CJI3#ALLCOST)
   * @param startDate Fecha en formato YYYY-MM-DD
   * @param periodType Tipo de período ('month' o 'day')
   */
  private generateSqprFileName(tcode: string, startDate: string, periodType: 'month' | 'day'): string {
    // Formatear la fecha según el tipo de TCode
    let formattedDate: string;
    
    if (tcode === 'ZFIR_STATLOAD' || tcode === 'ZFIR_STATSLOAD') {
      // Para ZFIR_STATSLOAD: formato YYYYMM
      formattedDate = this.formatDateForSummarySync(startDate);
    } else {
      // Para KSB1, KOB1, CJI3: formato DD.MM.YYYY
      formattedDate = this.formatDateForDetailsSync(startDate);
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
   * Ej: CJI3_ALLCOST -> CJI3#ALLCOST, CJI3_CANDALL -> CJI3#1CANDALL
   */
  private getTcodeForFileName(customName: string, tcode: string): string {
    const customNameUpper = customName.toUpperCase();
    
    // Mapeo de customName a formato TCode
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
    
    // Fallback: usar el tcode del formulario
    return tcode || customName;
  }

  /**
   * Aplica fechas y valores por defecto según el tipo de formulario
   */
  private applyDatesAndDefaults(form: any, dateString: string): any {
    const formData = { ...form.formData || {} };
    const tcode = form.tcode || form.customName || '';
    const customName = form.customName || '';

    // Aplicar fecha según el tipo
    if (tcode.includes('KSB1') || tcode.includes('KOB1') || customName.includes('CJI3')) {
      formData.startDate = dateString; // DD.MM.YYYY
    } else if (tcode.includes('ZFIR_STATSLOAD')) {
      formData.startDate = dateString; // YYYYMM
    }

    // Aplicar valores por defecto según el tipo de formulario
    if (tcode.includes('KSB1') || customName.includes('KSB1')) {
      formData.ControllingArea = formData.ControllingArea || '2000';
      formData.CostCenterGroup = formData.CostCenterGroup || '0001';
      formData.CostElementGroup = formData.CostElementGroup || 'CE_STD';
      formData.Layout = formData.Layout || '/ALLDETAIL';
      formData.Columns = formData.Columns || ['All'];
      formData.NoSum = formData.NoSum || ['All'];
    } else if (tcode.includes('KOB1') || customName.includes('KOB1')) {
      formData.ControllingArea = formData.ControllingArea || '2000';
      formData.OrderLOW = formData.OrderLOW || '50000000';
      formData.OrderHIGH = formData.OrderHIGH || '59999999';
      formData.CostElementGroup = formData.CostElementGroup || 'CE_STD';
      formData.Layout = formData.Layout || '/ALL_COST';
      formData.Columns = formData.Columns || ['All'];
      formData.NoSum = formData.NoSum || ['All'];
    } else if ((customName.includes('CJI3') && customName.includes('ALLCOST')) || 
               (tcode.includes('CJI3') && tcode.includes('ALLCOST'))) {
      formData.ControllingArea = formData.ControllingArea || '2000';
      formData['Database prof.'] = formData['Database prof.'] || '000000000001';
      formData.ProjectLOW = formData.ProjectLOW || '2000*';
      formData.ProjectHIGH = formData.ProjectHIGH || '2100*';
      formData['Network/OrderLOW'] = formData['Network/OrderLOW'] || '2100*';
      formData.CostElementGroup = formData.CostElementGroup || 'CE_STD';
      formData.Layout = formData.Layout || '/ALLCOST';
      formData.Columns = formData.Columns || ['All'];
      formData.NoSum = formData.NoSum || ['All'];
    } else if ((customName.includes('CJI3') && customName.includes('CANDALL')) || 
               (tcode.includes('CJI3') && tcode.includes('CANDALL'))) {
      formData.ControllingArea = formData.ControllingArea || '2000';
      formData['Database prof.'] = formData['Database prof.'] || '000000000001';
      formData.ProjectLOW = formData.ProjectLOW || '2000-CAP*';
      formData.ProjectHIGH = formData.ProjectHIGH || '2100-CAP*';
      formData.CostElementGroup = formData.CostElementGroup || 'CE_STD';
      formData.Layout = formData.Layout || '/1CANDALL';
      formData.FurtherSettings = formData.FurtherSettings || '99999999';
      formData.Columns = formData.Columns || ['All'];
      formData.NoSum = formData.NoSum || ['All'];
    }

    return formData;
  }
  
  packages: Package[] = [];
  currentPackageId: string | null = null;
  currentFormId: string | null = null;
  packageIdCounter = 0;
  formIdCounter = 0;
  formDataCache: { [key: string]: any } = {};
  jsonPreviewData: { [key: string]: any } = {};
  showCreatePackageModal = false;
  packageName = '';
  showFileSelectorModal = false;
  availableJsonFiles: SftpFile[] = [];
  loadingFiles = false;
  selectedPackageIdForFile: string | null = null;
  loadingPackages = false;
  historyStack: Package[][] = []; // Historial para deshacer
  maxHistorySize = 50;
  selectedFiles: Set<string> = new Set(); // Archivos seleccionados para agregar múltiples
  showMultiSelectMode = false; // Modo de selección múltiple
  
  // Variables para el modal de fechas
  showDateRangeModal = false;
  dateModalPeriodType: 'month' | 'day' | 'both' = 'both';
  dateModalTitle = 'Seleccionar Período';
  pendingSyncType: 'summary' | 'details' | 'custom' | null = null;
  pendingPackageId: string | null = null; // ID del paquete pendiente de guardar con fechas
  
  // Modal para seleccionar plantilla personalizada
  showCustomTemplateModal = false;
  availableCustomTemplates: SftpFile[] = [];
  loadingCustomTemplates = false;
  selectedCustomTemplate: SftpFile | null = null;

  // Propiedades para panel de ejecución y validación
  showExecutionPanel: boolean = false;
  executionSteps: ExecutionStep[] = [];
  executionLogs: ExecutionLog[] = [];
  validationResult: PackageValidationResult | null = null;
  isExecuting: boolean = false;
  executionStartTime: Date | null = null;
  executionEndTime: Date | null = null;
  executionResult: { success: number; errors: number; total: number } | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private sftpService: SftpService,
    private packageValidator: SyncPackageValidatorService
  ) {}

  ngOnInit(): void {
    this.loadPackagesFromSftp();
  }

  ngAfterViewInit(): void {
    this.renderPackages();
    setTimeout(() => {
      const currentForm = this.getCurrentForm();
      if (currentForm) {
        this.generateForm(currentForm.id, currentForm.parameters);
        this.restoreFormData(currentForm.id);
      }
    }, 100);
  }

  showMessage(message: string, type: 'success' | 'error' = 'success'): void {
    const messageArea = document.getElementById('messageArea');
    if (messageArea) {
      messageArea.innerHTML = `<div class="${type}">${message}</div>`;
      setTimeout(() => {
        messageArea.innerHTML = '';
      }, 5000);
    }
  }

  /**
   * Muestra un popup de éxito con los archivos guardados
   */
  showSuccessPopup(savedFiles: string[], failedFiles: string[]): void {
    console.log('showSuccessPopup llamado con:', { savedFiles, failedFiles });
    const directoryPath = `~/lek-files-dev/can/sap-queries$`; // Nota: El directorio backend puede mapear 'sap-queries' a esta ruta
    
    // Eliminar popup anterior si existe
    const existingPopup = document.getElementById('successPopup');
    if (existingPopup) {
      document.body.removeChild(existingPopup);
    }
    
    let message = `<div style="padding: 20px;">
      <h3 style="color: #4a9eff; margin-top: 0; margin-bottom: 15px;">✓ Archivos Guardados Exitosamente</h3>
      <p style="color: #b0c4de; margin-bottom: 10px;"><strong>Carpeta:</strong> ${directoryPath}</p>
      <p style="color: #b0c4de; margin-bottom: 15px;"><strong>Total de archivos guardados:</strong> ${savedFiles.length}</p>`;
    
    if (savedFiles.length > 0) {
      message += `<div style="background: #0f1626; padding: 15px; border-radius: 6px; margin-bottom: 15px; max-height: 300px; overflow-y: auto;">
        <p style="color: #4a9eff; font-weight: 600; margin-bottom: 10px;">Archivos guardados:</p>
        <ul style="color: #b0c4de; margin: 0; padding-left: 20px;">`;
      
      savedFiles.forEach(fileName => {
        message += `<li style="margin-bottom: 5px; font-family: monospace; font-size: 13px;">${fileName}</li>`;
      });
      
      message += `</ul></div>`;
    }
    
    if (failedFiles.length > 0) {
      message += `<div style="background: #2a1a1a; padding: 15px; border-radius: 6px; border-left: 4px solid #ff6b6b; margin-bottom: 15px;">
        <p style="color: #ff6b6b; font-weight: 600; margin-bottom: 10px;">Archivos con errores (${failedFiles.length}):</p>
        <ul style="color: #ffaaaa; margin: 0; padding-left: 20px;">`;
      
      failedFiles.forEach(fileName => {
        message += `<li style="margin-bottom: 5px; font-family: monospace; font-size: 13px;">${fileName}</li>`;
      });
      
      message += `</ul></div>`;
    }
    
    message += `</div>`;
    
    // Crear y mostrar el popup
    const popup = document.createElement('div');
    popup.id = 'successPopup';
    popup.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    `;
    
    const popupContent = document.createElement('div');
    popupContent.style.cssText = `
      background: #1a2332;
      border: 2px solid #4a9eff;
      border-radius: 8px;
      padding: 0;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;
    
    popupContent.innerHTML = message + `
      <div style="padding: 15px; border-top: 1px solid #2a3a5c; text-align: right;">
        <button id="closeSuccessPopup" style="
          background: #4a9eff;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
        ">Cerrar</button>
      </div>
    `;
    
    popup.appendChild(popupContent);
    document.body.appendChild(popup);
    console.log('Popup agregado al DOM');
    
    // Cerrar al hacer clic en el botón
    const closeButton = document.getElementById('closeSuccessPopup');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        if (document.body.contains(popup)) {
          document.body.removeChild(popup);
        }
      });
    }
    
    // Cerrar al hacer clic fuera del popup
    popup.addEventListener('click', (e) => {
      if (e.target === popup) {
        if (document.body.contains(popup)) {
          document.body.removeChild(popup);
        }
      }
    });
  }

  showCreatePackageModalDialog(): void {
    this.showCreatePackageModal = true;
    setTimeout(() => {
      const input = document.getElementById('packageName') as HTMLInputElement;
      if (input) input.focus();
    }, 100);
  }

  closeCreatePackageModal(): void {
    this.showCreatePackageModal = false;
    this.packageName = '';
  }

  createPackage(): void {
    const packageName = this.packageName.trim();
    
    if (!packageName) {
      this.showMessage('Por favor, ingrese un nombre para el paquete.', 'error');
      return;
    }

    const packageId = `pkg_${this.packageIdCounter++}`;
    const newPackage: Package = {
      id: packageId,
      name: packageName,
      forms: []
    };

    this.packages.push(newPackage);
    this.closeCreatePackageModal();
    this.saveToHistory();
    this.renderPackages();
    this.selectPackage(packageId);
    this.showMessage(`Paquete "${packageName}" creado correctamente.`);
  }

  deletePackage(packageId: string): void {
    if (confirm('¿Está seguro de eliminar este paquete y todos sus formularios?')) {
      this.packages = this.packages.filter(pkg => pkg.id !== packageId);
      if (this.currentPackageId === packageId) {
        this.currentPackageId = null;
        this.currentFormId = null;
      }
      this.saveToHistory();
      this.renderPackages();
      this.showMessage('Paquete eliminado correctamente.');
    }
  }

  renamePackage(packageId: string): void {
    const pkg = this.packages.find(p => p.id === packageId);
    if (!pkg) return;

    const newName = prompt('Ingrese el nuevo nombre para el paquete:', pkg.name);
    if (newName && newName.trim()) {
      pkg.name = newName.trim();
      this.saveToHistory();
      this.renderPackages();
      this.showMessage('Nombre del paquete actualizado.');
    }
  }

  selectPackage(packageId: string): void {
    this.currentPackageId = packageId;
    const pkg = this.packages.find(p => p.id === packageId);
    if (pkg && pkg.forms.length > 0) {
      this.selectForm(pkg.forms[0].id);
    } else {
      this.currentFormId = null;
    }
    this.renderPackages();
  }

  /**
   * Abre el modal para seleccionar un archivo JSON desde SFTP
   */
  openFileSelectorModal(packageId: string): void {
    this.selectedPackageIdForFile = packageId;
    this.showFileSelectorModal = true;
    this.loadJsonFilesFromSftp();
  }

  /**
   * Carga la lista de archivos JSON desde el servidor SFTP
   */
  loadJsonFilesFromSftp(): void {
    this.loadingFiles = true;
    this.availableJsonFiles = [];

    this.sftpService.listJsonFiles().subscribe({
      next: (response) => {
        this.loadingFiles = false;
        if (response.status && response.files) {
          this.availableJsonFiles = response.files.filter(file => 
            !file.isDirectory && file.name.endsWith('.json')
          );
          if (this.availableJsonFiles.length === 0) {
            this.showMessage('No se encontraron archivos JSON en el servidor SFTP.', 'error');
          }
        } else {
          this.showMessage(response.message || 'Error al cargar archivos desde SFTP.', 'error');
        }
      },
      error: (error) => {
        this.loadingFiles = false;
        console.error('Error al cargar archivos desde SFTP:', error);
        this.showMessage('Error al conectar con el servidor SFTP. Verifique la conexión.', 'error');
      }
    });
  }

  /**
   * Cierra el modal de selección de archivos
   */
  closeFileSelectorModal(): void {
    this.showFileSelectorModal = false;
    this.selectedPackageIdForFile = null;
    this.availableJsonFiles = [];
    this.selectedFiles.clear();
    this.showMultiSelectMode = false;
  }

  /**
   * Selecciona un archivo JSON desde SFTP y lo carga
   */
  selectJsonFileFromSftp(file: SftpFile): void {
    if (!this.selectedPackageIdForFile) return;

    // Si está en modo selección múltiple, solo agregar/quitar de la selección
    if (this.showMultiSelectMode) {
      if (this.selectedFiles.has(file.path)) {
        this.selectedFiles.delete(file.path);
      } else {
        this.selectedFiles.add(file.path);
      }
      return;
    }

    // Modo normal: cargar un solo archivo
    this.loadingFiles = true;
    this.sftpService.getJsonFileContent(file.path).subscribe({
      next: (response) => {
        this.loadingFiles = false;
        if (response.status && response.content) {
          this.processJsonPreview(response.content, this.selectedPackageIdForFile!);
          this.closeFileSelectorModal();
        } else {
          this.showMessage(response.message || 'Error al cargar el contenido del archivo.', 'error');
        }
      },
      error: (error) => {
        this.loadingFiles = false;
        console.error('Error al cargar archivo desde SFTP:', error);
        this.showMessage('Error al cargar el archivo desde SFTP.', 'error');
      }
    });
  }

  /**
   * Alterna el modo de selección múltiple
   */
  toggleMultiSelectMode(): void {
    this.showMultiSelectMode = !this.showMultiSelectMode;
    if (!this.showMultiSelectMode) {
      this.selectedFiles.clear();
    }
  }

  /**
   * Verifica si un archivo está seleccionado
   */
  isFileSelected(filePath: string): boolean {
    return this.selectedFiles.has(filePath);
  }

  /**
   * Agrega múltiples flujos seleccionados al paquete
   */
  addMultipleFlowsToPackage(): void {
    if (!this.selectedPackageIdForFile || this.selectedFiles.size === 0) {
      this.showMessage('Por favor, selecciona al menos un archivo.', 'error');
      return;
    }

    const filesToLoad = Array.from(this.selectedFiles);
    let loadedCount = 0;
    let errorCount = 0;
    const totalFiles = filesToLoad.length;

    this.loadingFiles = true;
    // No mostrar mensaje de info, solo mostrar cuando termine

    filesToLoad.forEach((filePath, index) => {
      const file = this.availableJsonFiles.find(f => f.path === filePath);
      if (!file) {
        errorCount++;
        if (errorCount + loadedCount === totalFiles) {
          this.loadingFiles = false;
          this.showMessage(`Error: No se pudo encontrar el archivo ${filePath}`, 'error');
        }
        return;
      }

      this.sftpService.getJsonFileContent(filePath).subscribe({
        next: (response) => {
          if (response.status && response.content) {
            try {
              const jsonData = JSON.parse(response.content);
              
              if (!jsonData.$meta || !jsonData.$meta.tcode) {
                errorCount++;
                this.showMessage(`El archivo ${file.name} no contiene $meta.tcode.`, 'error');
              } else {
                // Crear formulario directamente sin preview
                this.createFormFromJsonData(jsonData, this.selectedPackageIdForFile!, file.name);
                loadedCount++;
              }
            } catch (error) {
              errorCount++;
              this.showMessage(`Error al procesar ${file.name}: ${error}`, 'error');
            }
          } else {
            errorCount++;
            this.showMessage(`Error al cargar ${file.name}: ${response.message}`, 'error');
          }

          // Verificar si terminamos de cargar todos
          if (loadedCount + errorCount === totalFiles) {
            this.loadingFiles = false;
            this.selectedFiles.clear();
            this.showMultiSelectMode = false;
            this.closeFileSelectorModal();
            
            if (loadedCount > 0) {
              this.showMessage(`${loadedCount} flujo(s) agregado(s) exitosamente${errorCount > 0 ? `, ${errorCount} error(es)` : ''}.`, 'success');
            }
          }
        },
        error: (error) => {
          errorCount++;
          console.error(`Error al cargar archivo ${filePath}:`, error);
          
          if (loadedCount + errorCount === totalFiles) {
            this.loadingFiles = false;
            this.selectedFiles.clear();
            this.showMultiSelectMode = false;
            this.closeFileSelectorModal();
            this.showMessage(`Error al cargar archivos. ${loadedCount} exitoso(s), ${errorCount} error(es).`, 'error');
          }
        }
      });
    });
  }

  /**
   * Crea un formulario directamente desde datos JSON (sin preview)
   */
  private createFormFromJsonData(jsonData: any, packageId: string, fileName: string): void {
    const tcode = jsonData.$meta?.tcode || fileName.replace('.json', '');
    const customName = tcode; // Usar tcode como nombre por defecto, el usuario puede cambiarlo después
    
    const parameters = this.extractParameters(jsonData);
    const parametersSet = new Set<string>(parameters);
    if (!parametersSet.has('Columns')) {
      parametersSet.add('Columns');
    }
    if (!parametersSet.has('NoSum')) {
      parametersSet.add('NoSum');
    }
    const allParameters: string[] = Array.from(parametersSet);

    const formId = `form_${this.formIdCounter++}`;
    const newForm: Form = {
      id: formId,
      tcode: tcode,
      customName: customName,
      jsonData: jsonData,
      parameters: allParameters
    };

    const pkg = this.packages.find(p => p.id === packageId);
    if (pkg) {
      pkg.forms.push(newForm);
      this.saveToHistory();
      this.renderPackages();
      this.selectForm(formId);
    }
  }

  processJsonPreview(jsonText: string, packageId: string): void {
    try {
      const jsonData = JSON.parse(jsonText);
      
      if (!jsonData.$meta || !jsonData.$meta.tcode) {
        this.showMessage('El JSON debe contener $meta.tcode.', 'error');
        return;
      }

      const parameters = this.extractParameters(jsonData);
      
      if (parameters.length === 0) {
        this.showMessage('No se encontraron parámetros con action "set" en los steps.', 'error');
        return;
      }

      this.jsonPreviewData[packageId] = {
        jsonData: jsonData,
        parameters: parameters
      };

      this.updateJsonPreview(packageId, jsonData, parameters);
      this.showMessage(`JSON válido. Se encontraron ${parameters.length} parámetros.`, 'success');
    } catch (error: any) {
      this.showMessage(`Error al procesar JSON: ${error.message}`, 'error');
      this.clearJsonPreview(packageId);
    }
  }

  updateJsonPreview(packageId: string, jsonData: any, parameters: string[]): void {
    const previewDiv = document.getElementById(`jsonPreview_${packageId}`);
    const actionsBar = document.getElementById(`formActions_${packageId}`);
    
    if (previewDiv) {
      previewDiv.innerHTML = `
        <h4>Vista Previa del Formulario</h4>
        <div class="json-preview-info">
          <div class="preview-item">
            <label>TCode:</label>
            <value>${jsonData.$meta.tcode}</value>
          </div>
          <div class="preview-item">
            <label>Descripción:</label>
            <value>${jsonData.$meta.description || 'Sin descripción'}</value>
          </div>
          <div class="preview-item">
            <label>Parámetros encontrados:</label>
            <value>${parameters.length}</value>
          </div>
        </div>
        <div style="margin-top: 15px;">
          <label style="color: #b0c4de; font-size: 14px;">Parámetros que se crearán:</label>
          <div style="margin-top: 10px; padding: 10px; background: #1a1a2e; border-radius: 6px; max-height: 150px; overflow-y: auto;">
            ${parameters.map(p => `<div style="color: #e0e0e0; padding: 5px 0; border-bottom: 1px solid #2a3a5c;">• ${p}</div>`).join('')}
          </div>
        </div>
      `;
      previewDiv.classList.remove('hidden');
    }
    
    if (actionsBar) {
      actionsBar.style.display = 'flex';
    }
  }

  clearJsonPreview(packageId: string): void {
    const previewDiv = document.getElementById(`jsonPreview_${packageId}`);
    const actionsBar = document.getElementById(`formActions_${packageId}`);
    
    if (previewDiv) previewDiv.classList.add('hidden');
    if (actionsBar) actionsBar.style.display = 'none';
    
    delete this.jsonPreviewData[packageId];
  }

  createFormFromPreview(packageId: string): void {
    const preview = this.jsonPreviewData[packageId];
    if (!preview) {
      this.showMessage('No hay datos JSON para crear el formulario.', 'error');
      return;
    }

    const customNameInput = document.getElementById(`formCustomName_${packageId}`) as HTMLInputElement;
    const customName = customNameInput ? customNameInput.value.trim() : '';
    const formName = customName || preview.jsonData.$meta.tcode;

    const parametersSet = new Set<string>(preview.parameters);
    if (!parametersSet.has('Columns')) {
      parametersSet.add('Columns');
    }
    if (!parametersSet.has('NoSum')) {
      parametersSet.add('NoSum');
    }
    const allParameters: string[] = Array.from(parametersSet);

    const formId = `form_${this.formIdCounter++}`;
    const newForm: Form = {
      id: formId,
      tcode: preview.jsonData.$meta.tcode,
      customName: formName,
      jsonData: preview.jsonData,
      parameters: allParameters
    };

    const pkg = this.packages.find(p => p.id === packageId);
    if (pkg) {
      pkg.forms.push(newForm);
      this.clearJsonPreview(packageId);
      this.saveToHistory();
      this.renderPackages();
      this.selectForm(formId);
      this.showMessage(`Formulario "${formName}" creado correctamente.`);
    }
  }

  extractParameters(data: any): string[] {
    const params = new Set<string>();
    
    if (!data.steps) {
      return [];
    }

    Object.keys(data.steps).forEach(stepKey => {
      const step = data.steps[stepKey];
      
      if (typeof step === 'object' && step !== null) {
        Object.keys(step).forEach(actionKey => {
          const action = step[actionKey];
          if (action && action.action === 'set' && action.target) {
            params.add(action.target);
          }
        });
      }
    });

    return Array.from(params);
  }

  selectForm(formId: string): void {
    if (this.currentFormId && this.currentFormId !== formId) {
      this.saveFormData(this.currentFormId);
    }
    
    this.currentFormId = formId;
    this.renderPackages();
    
    // Generar el formulario después de que Angular actualice la vista
    setTimeout(() => {
      const form = this.findFormById(formId);
      if (form) {
        this.generateForm(form.id, form.parameters);
        this.restoreFormData(form.id);
      }
    }, 100);
  }

  saveFormData(formId: string): void {
    const form = this.findFormById(formId);
    if (!form) return;

    // Verificar si es CJI3_ALLCOST, CJI3_CANDALL, KOB1 o KSB1 para guardar Columns y NoSum como arrays
    const isCJI3 = form.customName === 'CJI3_ALLCOST' || form.customName === 'CJI3_CANDALL';
    const isKOB1 = form.tcode === 'KOB1' || form.customName === 'KOB1';
    const isKSB1 = form.tcode === 'KSB1' || form.customName === 'KSB1';
    const needsArrayFormat = isCJI3 || isKOB1 || isKSB1;

    const savedData: any = {};
    
    form.parameters.forEach(param => {
      const paramId = `param_${formId}_${param.replace(/\s+/g, '_')}`;
      
      if (param === 'Columns' || param === 'NoSum') {
        const checkbox = document.getElementById(paramId) as HTMLInputElement;
        if (checkbox) {
          // Para CJI3_ALLCOST, CJI3_CANDALL, KOB1 y KSB1, guardar como array ["All"] si está marcado
          if (needsArrayFormat) {
            savedData[param] = checkbox.checked ? ['All'] : [];
          } else {
            savedData[param] = checkbox.checked;
          }
        }
      } else {
        const input = document.getElementById(paramId) as HTMLInputElement;
        if (input) {
          savedData[param] = input.value;
        }
      }
    });

    this.formDataCache[formId] = savedData;
  }

  restoreFormData(formId: string): void {
    const savedData = this.formDataCache[formId];
    if (!savedData) return;

    const form = this.findFormById(formId);
    if (!form) return;

    form.parameters.forEach(param => {
      // Normalizar el nombre del parámetro para buscar en savedData
      const paramId = `param_${formId}_${param.replace(/\s+/g, '_')}`;
      
      if (param === 'Columns' || param === 'NoSum') {
        const checkbox = document.getElementById(paramId) as HTMLInputElement;
        if (checkbox && savedData[param] !== undefined) {
          // Para CJI3_ALLCOST, Columns y NoSum son arrays ["All"]
          // Si es un array con "All", marcar el checkbox
          if (Array.isArray(savedData[param]) && savedData[param].includes('All')) {
            checkbox.checked = true;
          } else if (typeof savedData[param] === 'boolean') {
            checkbox.checked = savedData[param];
          } else {
            checkbox.checked = false;
          }
        }
      } else {
        const input = document.getElementById(paramId) as HTMLInputElement;
        if (input) {
          // Buscar el valor en savedData con diferentes variaciones del nombre
          let value = savedData[param];
          
          // Si no se encuentra, buscar variaciones comunes
          if (value === undefined) {
            const variations = [
              param,
              param.toLowerCase(),
              param.toUpperCase(),
              param.replace(/\s+/g, ''),
              param.replace(/\s+/g, '_')
            ];
            
            for (const variation of variations) {
              if (savedData[variation] !== undefined) {
                value = savedData[variation];
                break;
              }
            }
          }
          
          if (value !== undefined && value !== null && value !== '') {
            input.value = String(value);
          } else {
            // Si no hay valor, asegurar que el placeholder sea visible
            input.value = '';
            // Re-establecer el placeholder por si se perdió
            const placeholderText = this.getPlaceholderText(param);
            input.placeholder = placeholderText;
            input.setAttribute('placeholder', placeholderText);
          }
        }
      }
    });
  }

  deleteForm(packageId: string, formId: string): void {
    if (confirm('¿Está seguro de eliminar este formulario?')) {
      const pkg = this.packages.find(p => p.id === packageId);
      if (pkg) {
        pkg.forms = pkg.forms.filter(form => form.id !== formId);
        
        delete this.formDataCache[formId];
        
        if (this.currentFormId === formId) {
          if (pkg.forms.length > 0) {
            this.selectForm(pkg.forms[0].id);
          } else {
            this.currentFormId = null;
          }
        }
        this.saveToHistory();
        this.renderPackages();
        this.showMessage('Formulario eliminado correctamente.');
      }
    }
  }

  renameForm(packageId: string, formId: string): void {
    const pkg = this.packages.find(p => p.id === packageId);
    if (!pkg) return;
    
    const form = pkg.forms.find(f => f.id === formId);
    if (!form) return;

    const newName = prompt('Ingrese el nuevo nombre para el formulario:', form.customName);
    if (newName && newName.trim()) {
      form.customName = newName.trim();
      this.saveToHistory();
      this.renderPackages();
      this.showMessage('Nombre del formulario actualizado.');
    }
  }

  renderPackages(): void {
    // Esta función se maneja principalmente en el template con *ngFor
    // Angular detecta automáticamente los cambios en los arrays
    // Forzamos detección de cambios si es necesario
    this.cdr.detectChanges();
  }

  /**
   * Genera un texto de placeholder descriptivo para un parámetro
   */
  getPlaceholderText(param: string): string {
    const paramLower = param.toLowerCase().trim();
    const paramOriginal = param.trim();
    
    // Placeholders específicos para campos de fecha
    if (paramLower.includes('date') && paramLower.includes('low')) {
      return 'Ingrese Fecha Inicio (YYYY-MM-DD)';
    }
    if (paramLower.includes('date') && paramLower.includes('high')) {
      return 'Ingrese Fecha Fin (YYYY-MM-DD)';
    }
    if (paramLower.includes('date') && paramLower.includes('from')) {
      return 'Ingrese Fecha Desde (YYYY-MM-DD)';
    }
    if (paramLower.includes('date') && paramLower.includes('to')) {
      return 'Ingrese Fecha Hasta (YYYY-MM-DD)';
    }
    if (paramLower.includes('date')) {
      return 'Ingrese Fecha (YYYY-MM-DD)';
    }
    
    // Placeholders para períodos
    if (paramLower.includes('period')) {
      return 'Ingrese Período (YYYY-MM)';
    }
    if (paramLower.includes('year')) {
      return 'Ingrese Año (YYYY)';
    }
    if (paramLower.includes('month')) {
      return 'Ingrese Mes (MM)';
    }
    
    // Placeholders para códigos e identificadores
    if (paramLower.includes('code') || paramLower.includes('cod')) {
      return 'Ingrese Código';
    }
    if (paramLower.includes('id') || paramLower.includes('identifier')) {
      return 'Ingrese ID o Identificador';
    }
    if (paramLower.includes('key')) {
      return 'Ingrese Clave';
    }
    
    // Placeholders para áreas y centros
    if (paramLower.includes('area')) {
      return 'Ingrese Área';
    }
    if (paramLower.includes('center') || paramLower.includes('centro')) {
      return 'Ingrese Centro';
    }
    if (paramLower.includes('costcenter') || paramLower.includes('cost_center')) {
      return 'Ingrese Centro de Costo';
    }
    
    // Placeholders para elementos y grupos
    if (paramLower.includes('element') || paramLower.includes('elemento')) {
      return 'Ingrese Elemento';
    }
    if (paramLower.includes('group') || paramLower.includes('grupo')) {
      return 'Ingrese Grupo';
    }
    if (paramLower.includes('account') || paramLower.includes('cuenta')) {
      return 'Ingrese Cuenta';
    }
    
    // Placeholders para proyectos
    if (paramLower.includes('project') || paramLower.includes('proyecto')) {
      return 'Ingrese Proyecto';
    }
    if (paramLower.includes('wbs') || paramLower.includes('wbs_element')) {
      return 'Ingrese Elemento WBS';
    }
    
    // Placeholders para layouts y perfiles
    if (paramLower.includes('layout')) {
      return 'Ingrese Layout';
    }
    if (paramLower.includes('profile') || paramLower.includes('prof')) {
      return 'Ingrese Perfil';
    }
    if (paramLower.includes('variant') || paramLower.includes('variante')) {
      return 'Ingrese Variante';
    }
    
    // Placeholders para valores y montos
    if (paramLower.includes('amount') || paramLower.includes('monto') || paramLower.includes('importe')) {
      return 'Ingrese Monto';
    }
    if (paramLower.includes('value') || paramLower.includes('valor')) {
      return 'Ingrese Valor';
    }
    if (paramLower.includes('currency') || paramLower.includes('moneda')) {
      return 'Ingrese Moneda';
    }
    
    // Placeholders para rangos
    if (paramLower.includes('range') || paramLower.includes('rango')) {
      return 'Ingrese Rango';
    }
    if (paramLower.includes('from')) {
      return 'Ingrese Valor Desde';
    }
    if (paramLower.includes('to')) {
      return 'Ingrese Valor Hasta';
    }
    
    // Placeholders para tipos y categorías
    if (paramLower.includes('type') || paramLower.includes('tipo')) {
      return 'Ingrese Tipo';
    }
    if (paramLower.includes('category') || paramLower.includes('categoria')) {
      return 'Ingrese Categoría';
    }
    if (paramLower.includes('class') || paramLower.includes('clase')) {
      return 'Ingrese Clase';
    }
    
    // Placeholders para nombres y descripciones
    if (paramLower.includes('name') || paramLower.includes('nombre')) {
      return 'Ingrese Nombre';
    }
    if (paramLower.includes('description') || paramLower.includes('descripcion')) {
      return 'Ingrese Descripción';
    }
    if (paramLower.includes('text') || paramLower.includes('texto')) {
      return 'Ingrese Texto';
    }
    
    // Placeholders para empresas y sociedades
    if (paramLower.includes('company') || paramLower.includes('empresa') || paramLower.includes('sociedad')) {
      return 'Ingrese Empresa/Sociedad';
    }
    if (paramLower.includes('plant') || paramLower.includes('planta')) {
      return 'Ingrese Planta';
    }
    
    // Placeholders para niveles y jerarquías
    if (paramLower.includes('level') || paramLower.includes('nivel')) {
      return 'Ingrese Nivel';
    }
    if (paramLower.includes('hierarchy') || paramLower.includes('jerarquia')) {
      return 'Ingrese Jerarquía';
    }
    
    // Placeholders para estados y flags
    if (paramLower.includes('status') || paramLower.includes('estado')) {
      return 'Ingrese Estado';
    }
    if (paramLower.includes('flag') || paramLower.includes('marca')) {
      return 'Ingrese Flag/Marca';
    }
    
    // Placeholders para versiones
    if (paramLower.includes('version') || paramLower.includes('version')) {
      return 'Ingrese Versión';
    }
    
    // Placeholders para órdenes y documentos
    if (paramLower.includes('order') || paramLower.includes('orden')) {
      return 'Ingrese Orden';
    }
    if (paramLower.includes('document') || paramLower.includes('documento')) {
      return 'Ingrese Documento';
    }
    
    // Placeholder genérico mejorado - siempre debe tener un placeholder
    // Si el parámetro tiene guiones bajos o guiones, los reemplazamos con espacios
    const paramFormatted = paramOriginal.replace(/[_-]/g, ' ');
    return `Ingrese ${paramFormatted}`;
  }

  generateForm(formId: string, params: string[]): void {
    const formContainer = document.getElementById(`form_${formId}`);
    if (!formContainer) return;

    formContainer.innerHTML = '';

    const allParams = new Set(params);
    
    if (!allParams.has('Columns')) {
      allParams.add('Columns');
    }
    if (!allParams.has('NoSum')) {
      allParams.add('NoSum');
    }

    const sortedParams = Array.from(allParams).sort((a, b) => {
      if (a === 'Columns' || a === 'NoSum') return 1;
      if (b === 'Columns' || b === 'NoSum') return -1;
      return 0;
    });

    sortedParams.forEach(param => {
      const paramId = param.replace(/\s+/g, '_');
      const fieldDiv = document.createElement('div');
      
      if (param === 'Columns' || param === 'NoSum') {
        fieldDiv.className = 'form-field';
        
        // Crear contenedor para el checkbox con estilo mejorado
        const checkboxGroup = document.createElement('div');
        checkboxGroup.className = 'checkbox-group';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `param_${formId}_${paramId}`;
        checkbox.name = param;
        checkbox.className = 'form-check-input';
        
        checkbox.addEventListener('change', () => {
          this.saveFormData(formId);
        });
        
        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.setAttribute('for', `param_${formId}_${paramId}`);
        label.textContent = param;
        
        checkboxGroup.appendChild(checkbox);
        checkboxGroup.appendChild(label);
        
        fieldDiv.appendChild(checkboxGroup);
      } else {
        fieldDiv.className = 'form-field';
        
        const label = document.createElement('label');
        label.textContent = param;
        label.setAttribute('for', `param_${formId}_${paramId}`);
        
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `param_${formId}_${paramId}`;
        input.name = param;
        input.className = 'form-control';
        
        // Crear placeholder más descriptivo
        const placeholderText = this.getPlaceholderText(param);
        input.placeholder = placeholderText;
        input.setAttribute('placeholder', placeholderText);
        
        input.addEventListener('input', () => {
          this.saveFormData(formId);
        });
        
        fieldDiv.appendChild(label);
        fieldDiv.appendChild(input);
      }
      
      formContainer.appendChild(fieldDiv);
    });
  }

  collectFormData(formId: string): any {
    const form = this.findFormById(formId);
    if (!form) return {};

    if (this.currentFormId === formId) {
      this.saveFormData(formId);
    }

    const formData: any = {};
    const savedData = this.formDataCache[formId] || {};
    
    form.parameters.forEach(param => {
      const paramId = `param_${formId}_${param.replace(/\s+/g, '_')}`;
      
      if (param === 'Columns' || param === 'NoSum') {
        const checkbox = document.getElementById(paramId) as HTMLInputElement;
        let isChecked = false;
        
        if (checkbox) {
          isChecked = checkbox.checked;
        } else if (savedData[param] !== undefined) {
          isChecked = savedData[param];
        }
        
        if (isChecked) {
          formData[param] = ["All"];
        }
      } else {
        const input = document.getElementById(paramId) as HTMLInputElement;
        let value = '';
        
        if (input && input.value.trim()) {
          value = input.value.trim();
        } else if (savedData[param] !== undefined && savedData[param].trim()) {
          value = savedData[param].trim();
        }
        
        if (value) {
          formData[param] = value;
        }
      }
    });

    ['Columns', 'NoSum'].forEach(param => {
      if (!formData[param]) {
        const paramId = `param_${formId}_${param.replace(/\s+/g, '_')}`;
        const checkbox = document.getElementById(paramId) as HTMLInputElement;
        let isChecked = false;
        
        if (checkbox) {
          isChecked = checkbox.checked;
        } else if (savedData[param] !== undefined) {
          isChecked = savedData[param];
        }
        
        if (isChecked) {
          formData[param] = ["All"];
        }
      }
    });

    formData.tcode = form.tcode;

    return formData;
  }

  findFormById(formId: string): Form | null {
    for (const pkg of this.packages) {
      const form = pkg.forms.find(f => f.id === formId);
      if (form) return form;
    }
    return null;
  }

  exportJSON(formId: string): void {
    const formData = this.collectFormData(formId);
    
    if (Object.keys(formData).length === 0) {
      this.showMessage('Por favor, complete al menos un campo del formulario.', 'error');
      return;
    }

    const form = this.findFormById(formId);
    const filename = `${form ? form.customName : 'parametros'}.json`;
    const jsonString = JSON.stringify(formData, null, 2);
    this.downloadFile(jsonString, filename, 'application/json');
    this.showMessage('JSON exportado correctamente.');
  }

  exportFormatted(formId: string): void {
    const formData = this.collectFormData(formId);
    
    if (Object.keys(formData).length === 0) {
      this.showMessage('Por favor, complete al menos un campo del formulario.', 'error');
      return;
    }

    const form = this.findFormById(formId);
    let formatted = '=== PARÁMETROS EXPORTADOS ===\n\n';
    
    Object.keys(formData).forEach(key => {
      if (Array.isArray(formData[key])) {
        formatted += `${key}:\n`;
        formData[key].forEach((item: any, index: number) => {
          formatted += `  ${index + 1}. ${item}\n`;
        });
      } else {
        formatted += `${key}: ${formData[key]}\n`;
      }
      formatted += '\n';
    });

    const filename = `${form ? form.customName : 'parametros'}.txt`;
    this.downloadFile(formatted, filename, 'text/plain');
    this.showMessage('Formato legible exportado correctamente.');
  }

  exportCSV(formId: string): void {
    const formData = this.collectFormData(formId);
    
    if (Object.keys(formData).length === 0) {
      this.showMessage('Por favor, complete al menos un campo del formulario.', 'error');
      return;
    }

    const form = this.findFormById(formId);
    let csv = 'Parámetro,Valor\n';
    
    Object.keys(formData).forEach(key => {
      if (Array.isArray(formData[key])) {
        csv += `"${key}","${formData[key].join('; ')}"\n`;
      } else {
        csv += `"${key}","${formData[key]}"\n`;
      }
    });

    const filename = `${form ? form.customName : 'parametros'}.csv`;
    this.downloadFile(csv, filename, 'text/csv');
    this.showMessage('CSV exportado correctamente.');
  }

  downloadFile(content: string, filename: string, contentType: string): void {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  exportPackage(packageId: string): void {
    const pkg = this.packages.find(p => p.id === packageId);
    if (!pkg) {
      this.showMessage('Paquete no encontrado.', 'error');
      return;
    }

    if (pkg.forms.length === 0) {
      this.showMessage('El paquete no tiene formularios para exportar.', 'error');
      return;
    }

    if (this.currentFormId) {
      this.saveFormData(this.currentFormId);
    }

    const packageData: any = {};
    
    pkg.forms.forEach(form => {
      const formData = this.collectFormData(form.id);
      packageData[form.customName] = formData;
    });

    const jsonString = JSON.stringify(packageData, null, 2);
    const sanitizedName = pkg.name.replace(/[^a-z0-9áéíóúñüÁÉÍÓÚÑÜ\s-]/gi, '_').replace(/\s+/g, '_');
    const filename = `${sanitizedName}.json`;
    
    this.downloadFile(jsonString, filename, 'application/json');
    this.showMessage(`Paquete "${pkg.name}" exportado correctamente con ${pkg.forms.length} formulario${pkg.forms.length > 1 ? 's' : ''}.`);
  }

  savePackageToSftp(packageId: string): void {
    const pkg = this.packages.find(p => p.id === packageId);
    if (!pkg) {
      this.showMessage('Paquete no encontrado.', 'error');
      return;
    }

    if (pkg.forms.length === 0) {
      this.showMessage('El paquete no tiene formularios para guardar.', 'error');
      return;
    }

    // Verificar si es un paquete de sincronización
    const isSummarySync = pkg.name.toUpperCase().includes('SUMMARY_SYNC') || 
                         pkg.name.toUpperCase().includes('ZFIR_STATLOAD');
    const isDetailsSync = pkg.name.toUpperCase().includes('DETAILS_SYNC') || 
                         (pkg.forms.some(f => ['KSB1', 'KOB1', 'CJI3_ALLCOST', 'CJI3_CANDALL'].includes(f.customName)));

    // Verificar si el paquete ya tiene fechas aplicadas (el nombre incluye un patrón de fecha)
    // Patrón para SUMMARY_SYNC: SUMMARY_SYNC_YYYY_MM
    // Patrón para DETAILS_SYNC: DETAILS_SYNC_YYYY_MM o DETAILS_SYNC_YYYY_MM_DD_YYYY_MM_DD
    const hasDatePattern = /\d{4}[_-]\d{2}([_-]\d{2}[_-]\d{4}[_-]\d{2})?$/.test(pkg.name);

    // Si es un paquete de sincronización pero NO tiene fechas aplicadas, pedir fechas antes de guardar
    if ((isSummarySync || isDetailsSync) && !hasDatePattern) {
      this.pendingSyncType = isSummarySync ? 'summary' : 'details';
      this.dateModalPeriodType = isSummarySync ? 'month' : 'both';
      this.dateModalTitle = isSummarySync 
        ? 'SUMMARY_SYNC - Seleccionar Mes para Guardar' 
        : 'DETAILS_SYNC - Seleccionar Período para Guardar';
      this.pendingPackageId = packageId; // Guardar el ID del paquete para guardarlo después
      this.showDateRangeModal = true;
      return;
    }

    // Si no es un paquete de sincronización, o ya tiene fechas aplicadas, guardar directamente
    this.performSavePackage(packageId, null);
  }

  /**
   * Realiza el guardado del paquete en SFTP, aplicando fechas si se proporcionan
   */
  private performSavePackage(packageId: string, dateRange: DateRange | null): void {
    const pkg = this.packages.find(p => p.id === packageId);
    if (!pkg) {
      this.showMessage('Paquete no encontrado.', 'error');
      return;
    }

    // ===== VALIDACIÓN ANTES DE EJECUTAR =====
    const validationDateRange = dateRange ? {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      periodType: dateRange.periodType
    } : undefined;
    
    this.validationResult = this.packageValidator.validatePackage(pkg, validationDateRange);
    this.addExecutionLog('info', 'Validación del paquete completada', {
      isValid: this.validationResult.isValid,
      errors: this.validationResult.errors.length,
      warnings: this.validationResult.warnings.length
    });
    
    // Si hay errores críticos, mostrar y no ejecutar
    if (this.validationResult.errors.length > 0) {
      const errorMessages = this.validationResult.errors.map(e => e.message).join('\n');
      this.showMessage(`Error: El paquete tiene ${this.validationResult.errors.length} error(es) que deben corregirse antes de ejecutar:\n${errorMessages}`, 'error');
      this.showExecutionPanel = true; // Mostrar panel para ver errores
      return;
    }
    
    // Si hay warnings, mostrar pero permitir ejecutar
    if (this.validationResult.warnings.length > 0) {
      const warningMessages = this.validationResult.warnings.slice(0, 3).map(w => w.message).join('\n');
      const moreWarnings = this.validationResult.warnings.length > 3 ? `\n... y ${this.validationResult.warnings.length - 3} advertencia(s) más` : '';
      this.addExecutionLog('warning', `El paquete tiene ${this.validationResult.warnings.length} advertencia(s):\n${warningMessages}${moreWarnings}`);
    }
    // ===== FIN VALIDACIÓN =====

    // Inicializar panel de ejecución
    this.initializeExecutionPanel(pkg, dateRange);

    // Guardar datos del formulario actual antes de guardar
    if (this.currentFormId) {
      this.saveFormData(this.currentFormId);
    }

    // Si se proporcionaron fechas, guardar cada formulario por separado en formato .sqpr
    if (dateRange) {
      // Guardar cada formulario por separado con el formato antiguo
      let formsToSave = pkg.forms;
      let savedCount = 0;
      const totalForms = formsToSave.length;
      const savedFiles: string[] = []; // Lista de archivos guardados exitosamente
      const failedFiles: string[] = []; // Lista de archivos que fallaron
      
      // Iniciar ejecución
      this.isExecuting = true;
      this.executionStartTime = new Date();
      this.addExecutionLog('info', `Iniciando ejecución de ${totalForms} formulario(s)`);
      
      formsToSave.forEach((form, index) => {
        // Crear step de ejecución
        const stepId = `step_${form.id}_${index}`;
        const tcodeForFile = this.getTcodeForFileName(form.customName, form.tcode);
        const fileName = this.generateSqprFileName(tcodeForFile, dateRange.startDate, dateRange.periodType);
        
        const step: ExecutionStep = {
          id: stepId,
          formId: form.id,
          formName: form.customName,
          fileName: fileName,
          status: 'pending'
        };
        this.executionSteps.push(step);
        this.addExecutionLog('info', `Preparando formulario: ${form.customName}`, { stepId, fileName });
        // Guardar datos del formulario actual
        if (this.currentFormId === form.id) {
          this.saveFormData(form.id);
        }
        
        const formData = this.collectFormData(form.id);
        
        // Aplicar fechas al formulario
        const formDataWithDates = this.applyDatesToForm(formData, dateRange, form.tcode, form.customName);
        
        // Actualizar estado del step a ejecutando
        this.updateStepStatus(stepId, 'executing');
        this.addExecutionLog('info', `Ejecutando formulario: ${form.customName}`, { stepId, fileName });
        
        // Guardar el formulario individual
        // IMPORTANTE: Guardar en el directorio de PAQUETES (sap-queries), NO en sap-query-package
        console.log(`Guardando paquete de sincronización "${form.customName}" como ${fileName} en directorio: ${this.QUERIES_DIRECTORY}`);
        const stepStartTime = new Date();
        
        this.sftpService.savePackageToSftp(fileName, formDataWithDates, false, this.QUERIES_DIRECTORY).subscribe({
          next: (response) => {
            savedCount++;
            const stepEndTime = new Date();
            const duration = stepEndTime.getTime() - stepStartTime.getTime();
            
            console.log(`Respuesta del servidor para ${form.customName}:`, response);
            if (response.status) {
              // Usar el nombre del archivo que devolvió el servidor, o el que enviamos
              const actualFileName = response.fileName || fileName;
              console.log(`✓ Formulario ${form.customName} guardado como ${actualFileName}`);
              savedFiles.push(actualFileName);
              
              // Validar archivo generado
              const fileSize = new Blob([JSON.stringify(formDataWithDates)]).size;
              const validation = this.packageValidator.validateGeneratedFile(actualFileName, fileSize);
              
              // Actualizar step como completado
              this.updateStepStatus(stepId, 'completed', {
                duration,
                fileSize,
                validationResult: validation
              });
              
              this.addExecutionLog('success', `Formulario ${form.customName} guardado exitosamente como ${actualFileName}`, {
                stepId,
                fileName: actualFileName,
                duration: `${duration}ms`,
                fileSize
              });
              
              if (validation.warnings.length > 0) {
                this.addExecutionLog('warning', `Advertencias en ${actualFileName}: ${validation.warnings.join(', ')}`, { stepId });
              }
              
              if (savedCount === totalForms) {
                this.finishExecution(savedFiles, failedFiles);
              }
            } else {
              console.error(`Error al guardar ${form.customName}:`, response.message);
              failedFiles.push(fileName);
              
              // Actualizar step como error
              this.updateStepStatus(stepId, 'error', {
                duration: stepEndTime.getTime() - stepStartTime.getTime(),
                error: response.message || 'Error desconocido al guardar'
              });
              
              this.addExecutionLog('error', `Error al guardar ${form.customName}: ${response.message}`, {
                stepId,
                fileName,
                error: response.message
              });
              
              if (savedCount === totalForms) {
                this.finishExecution(savedFiles, failedFiles);
              }
            }
          },
          error: (error) => {
            savedCount++;
            const stepEndTime = new Date();
            const duration = stepEndTime.getTime() - stepStartTime.getTime();
            const errorMessage = error.error?.message || error.message || 'Error desconocido';
            
            console.error(`Error al guardar ${form.customName}:`, error);
            failedFiles.push(fileName);
            
            // Actualizar step como error
            this.updateStepStatus(stepId, 'error', {
              duration,
              error: errorMessage
            });
            
            this.addExecutionLog('error', `Error al guardar ${form.customName}: ${errorMessage}`, {
              stepId,
              fileName,
              error: errorMessage,
              stack: error.stack
            });
            
            if (savedCount === totalForms) {
              this.finishExecution(savedFiles, failedFiles);
            }
          }
        });
      });
      
      return;
    }
    
    // Si no hay fechas, guardar como paquete completo (formato antiguo para compatibilidad)
    let packageData: any = {};
    
    pkg.forms.forEach(form => {
      const formData = this.collectFormData(form.id);
      packageData[form.customName] = formData;
    });
    
    const finalPackageName = pkg.name;
    
    // Verificar si el paquete ya existe en sap-queries-dev
    this.sftpService.checkPackageExists(finalPackageName, this.QUERIES_DIRECTORY).subscribe({
        next: (existsResponse) => {
        let shouldOverwrite = false;
        
        if (existsResponse.exists) {
          // Si existe, preguntar si quiere sobrescribir
          const overwrite = confirm(
            `El paquete "${pkg.name}" ya existe en el servidor SFTP.\n\n` +
            `¿Desea sobrescribirlo con los cambios actuales?`
          );
          
          if (!overwrite) {
            this.showMessage('Operación cancelada.', 'error');
            return;
          }
          
          shouldOverwrite = true;
        } else {
          // Si no existe, confirmar guardado
          if (!confirm(`¿Está seguro de guardar el paquete "${pkg.name}" en el servidor SFTP?`)) {
            return;
          }
        }

        // Mostrar mensaje de carga
        this.showMessage('Guardando paquete en servidor SFTP...', 'success');

        // IMPORTANTE: Guardar en el directorio de PAQUETES (sap-queries), NO en sap-query-package
        console.log(`Guardando paquete de sincronización "${finalPackageName}" en directorio: ${this.QUERIES_DIRECTORY}`);
        this.sftpService.savePackageToSftp(finalPackageName, packageData, shouldOverwrite, this.QUERIES_DIRECTORY).subscribe({
          next: (response) => {
            if (response.status) {
              this.showMessage(
                `Paquete "${finalPackageName}" ${shouldOverwrite ? 'actualizado' : 'guardado'} correctamente en SFTP.${response.fileName ? ` Archivo: ${response.fileName}` : ''}`,
                'success'
              );
              // Guardar en historial después de guardar exitosamente
              this.saveToHistory();
            } else {
              this.showMessage(
                `Error al guardar el paquete: ${response.message}`,
                'error'
              );
            }
          },
          error: (error) => {
            console.error('Error al guardar paquete en SFTP:', error);
            this.showMessage(
              'Error al conectar con el servidor SFTP. Verifique la conexión.',
              'error'
            );
          }
        });
      },
      error: (error) => {
        console.error('Error al verificar existencia del paquete:', error);
        // Continuar con el guardado aunque falle la verificación
        if (confirm(`¿Está seguro de guardar el paquete "${finalPackageName}" en el servidor SFTP?`)) {
          this.showMessage('Guardando paquete en servidor SFTP...', 'success');
          // IMPORTANTE: Guardar en el directorio de PAQUETES (sap-queries), NO en sap-query-package
          console.log(`Guardando paquete de sincronización "${finalPackageName}" en directorio: ${this.QUERIES_DIRECTORY}`);
          this.sftpService.savePackageToSftp(finalPackageName, packageData, false, this.QUERIES_DIRECTORY).subscribe({
            next: (response) => {
              if (response.status) {
                this.showMessage(
                  `Paquete "${finalPackageName}" guardado correctamente en SFTP.${response.fileName ? ` Archivo: ${response.fileName}` : ''}`,
                  'success'
                );
                this.saveToHistory();
              } else {
                this.showMessage(
                  `Error al guardar el paquete: ${response.message}`,
                  'error'
                );
              }
            },
            error: (err) => {
              console.error('Error al guardar paquete en SFTP:', err);
              this.showMessage(
                'Error al conectar con el servidor SFTP. Verifique la conexión.',
                'error'
              );
            }
          });
        }
      }
    });
  }

  /**
   * Inicializa el componente sin cargar paquetes guardados
   * Los paquetes guardados en sap-queries son instancias finales, no plantillas
   * Las plantillas se crean desde los flujos en sap-config/sap-gui-flow$
   */
  loadPackagesFromSftp(): void {
    this.loadingPackages = true;
    // NO cargar paquetes guardados al inicio - estos son instancias finales, no plantillas
    // Las plantillas se crean dinámicamente desde los flujos cuando el usuario hace clic en SUMMARY_SYNC o DETAILS_SYNC
    setTimeout(() => {
      this.loadingPackages = false;
      // Inicializar con estado vacío - el usuario creará plantillas desde los flujos
      if (this.packages.length === 0) {
        // No inicializar paquetes por defecto - el usuario debe crear plantillas desde los flujos
      }
    }, 100);
  }

  /**
   * Carga un paquete específico desde SFTP
   */
  loadPackageFromSftp(file: SftpFile): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftpService.getJsonFileContent(file.path).subscribe({
        next: (response) => {
          if (response.status && response.content) {
            try {
              const packageData = JSON.parse(response.content);
              const packageName = file.name.replace('.json', '').replace(/_/g, ' ');
              
              const packageId = `pkg_${this.packageIdCounter++}`;
              const forms: Form[] = [];
              
              // Convertir los datos del paquete en formularios
              Object.keys(packageData).forEach((formName, index) => {
                const formData = packageData[formName];
                const formId = `form_${this.formIdCounter++}`;
                
                // Extraer tcode y parámetros
                const tcode = formData.tcode || '';
                const parameters = Object.keys(formData).filter(key => key !== 'tcode');
                
                // Crear jsonData básico para el formulario
                const jsonData = {
                  $meta: {
                    tcode: tcode,
                    description: formName
                  }
                };
                
                const form: Form = {
                  id: formId,
                  tcode: tcode,
                  customName: formName,
                  jsonData: jsonData,
                  parameters: parameters
                };
                
                forms.push(form);
                
                // Guardar los datos del formulario en el cache
                this.formDataCache[formId] = formData;
              });
              
              const newPackage: Package = {
                id: packageId,
                name: packageName,
                forms: forms
              };
              
              this.packages.push(newPackage);
              resolve();
            } catch (error) {
              console.error(`Error al parsear paquete ${file.name}:`, error);
              reject(error);
            }
          } else {
            reject(new Error(response.message || 'Error al cargar paquete'));
          }
        },
        error: (error) => {
          console.error(`Error al cargar paquete ${file.name}:`, error);
          reject(error);
        }
      });
    });
  }

  initializeDefaultPackages(): void {
    if (this.packages.length === 0) {
      const defaultPackages = [
        'UPDATE OPEX SUMMARY',
        'UPDATE OPEX DETAILS',
        'UPDATE CAPEX SUMMARY',
        'UPDATE CAPEX DETAILS'
      ];

      defaultPackages.forEach((packageName) => {
        const packageId = `pkg_${this.packageIdCounter++}`;
        const newPackage: Package = {
          id: packageId,
          name: packageName,
          forms: []
        };
        this.packages.push(newPackage);
      });

      if (this.packages.length > 0) {
        this.selectPackage(this.packages[0].id);
      }
      this.saveToHistory();
    }
  }

  /**
   * Guarda el estado actual en el historial para deshacer
   */
  saveToHistory(): void {
    // Crear una copia profunda del estado actual
    const stateCopy = JSON.parse(JSON.stringify(this.packages));
    this.historyStack.push(stateCopy);
    
    // Limitar el tamaño del historial
    if (this.historyStack.length > this.maxHistorySize) {
      this.historyStack.shift();
    }
  }

  /**
   * Deshace el último cambio
   */
  undo(): void {
    if (this.historyStack.length > 1) {
      // Remover el estado actual
      this.historyStack.pop();
      // Restaurar el estado anterior
      const previousState = this.historyStack[this.historyStack.length - 1];
      this.packages = JSON.parse(JSON.stringify(previousState));
      
      // Restaurar el paquete y formulario actual si existen
      if (this.currentPackageId) {
        const pkg = this.packages.find(p => p.id === this.currentPackageId);
        if (pkg && pkg.forms.length > 0) {
          this.selectForm(pkg.forms[0].id);
        }
      }
      
      this.renderPackages();
      this.showMessage('Cambios deshechos correctamente.', 'success');
    } else {
      this.showMessage('No hay cambios para deshacer.', 'error');
    }
  }

  getCurrentPackage(): Package | null {
    return this.packages.find(p => p.id === this.currentPackageId) || null;
  }

  getCurrentForm(): Form | null {
    return this.findFormById(this.currentFormId || '');
  }

  onModalClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.id === 'createPackageModal') {
      this.closeCreatePackageModal();
    }
  }

  openFileDialog(packageId: string): void {
    this.openFileSelectorModal(packageId);
  }

  /**
   * Formatea el tamaño del archivo en formato legible
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Formatea la fecha en formato legible
   */
  formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  }

  /**
   * Abre el modal para SUMMARY_SYNC (ZFIR_STATLOAD) - pide fechas antes de crear la plantilla
   */
  openSummarySyncModal(): void {
    console.log('openSummarySyncModal llamado - pidiendo fechas');
    this.pendingSyncType = 'summary';
    this.dateModalPeriodType = 'month';
    this.dateModalTitle = 'SUMMARY_SYNC - Seleccionar Mes';
    this.pendingPackageId = null; // No hay paquete pendiente, se creará uno nuevo
    this.showDateRangeModal = true;
  }

  /**
   * Abre el modal para DETAILS_SYNC (KSB1, KOB1, CJI3_ALLCOST, CJI3_CANDALL) - pide fechas antes de crear la plantilla
   */
  openDetailsSyncModal(): void {
    console.log('openDetailsSyncModal llamado - pidiendo fechas');
    this.pendingSyncType = 'details';
    this.dateModalPeriodType = 'both';
    this.dateModalTitle = 'DETAILS_SYNC - Seleccionar Período';
    this.pendingPackageId = null; // No hay paquete pendiente, se creará uno nuevo
    this.showDateRangeModal = true;
  }

  /**
   * Abre el modal para seleccionar una plantilla personalizada
   */
  openCustomTemplateModal(): void {
    this.showCustomTemplateModal = true;
    this.loadCustomTemplates();
  }

  /**
   * Carga las plantillas personalizadas disponibles desde SFTP
   */
  loadCustomTemplates(): void {
    this.loadingCustomTemplates = true;
    this.availableCustomTemplates = [];
    
    this.sftpService.listPackages(this.TEMPLATES_DIRECTORY).subscribe({
      next: (response) => {
        this.loadingCustomTemplates = false;
        if (response.status && response.files) {
          // Filtrar solo las plantillas personalizadas (excluir SUMMARY_SYNC y DETAILS_SYNC)
          this.availableCustomTemplates = response.files.filter(file => 
            !file.isDirectory && 
            file.name.endsWith('.json') &&
            !file.name.toLowerCase().includes('summary_sync') &&
            !file.name.toLowerCase().includes('details_sync')
          );
          
          if (this.availableCustomTemplates.length === 0) {
            this.showMessage('No se encontraron plantillas personalizadas. Crea una en el módulo "Editor de Plantillas".', 'error');
          }
        } else {
          this.showMessage('Error al cargar las plantillas desde el servidor SFTP', 'error');
        }
      },
      error: (error) => {
        this.loadingCustomTemplates = false;
        console.error('Error al cargar plantillas personalizadas:', error);
        this.showMessage('Error al conectar con el servidor SFTP', 'error');
      }
    });
  }

  /**
   * Selecciona una plantilla personalizada y pide fechas
   */
  selectCustomTemplate(template: SftpFile): void {
    this.selectedCustomTemplate = template;
    this.pendingSyncType = 'custom';
    this.dateModalPeriodType = 'both';
    this.dateModalTitle = `${template.name.replace('.json', '')} - Seleccionar Período`;
    this.pendingPackageId = null;
    this.showCustomTemplateModal = false;
    this.showDateRangeModal = true;
  }

  /**
   * Cierra el modal de selección de plantillas personalizadas
   */
  closeCustomTemplateModal(): void {
    this.showCustomTemplateModal = false;
    this.selectedCustomTemplate = null;
  }

  /**
   * Cierra el modal de fechas
   */
  closeDateRangeModal(): void {
    this.showDateRangeModal = false;
    this.pendingSyncType = null;
    this.pendingPackageId = null;
    this.selectedCustomTemplate = null;
  }

  /**
   * Carga una plantilla personalizada desde sap-query-package y crea una instancia con fechas
   * Similar a generateDetailsSyncPackage pero para plantillas personalizadas
   */
  generateCustomTemplatePackage(templateFile: SftpFile, dateRange: DateRange | null): void {
    console.log('generateCustomTemplatePackage llamado con:', templateFile, dateRange);
    
    // Cargar el contenido de la plantilla personalizada
    this.sftpService.getJsonFileContent(templateFile.path).subscribe({
      next: (response) => {
        if (!response.status || !response.content) {
          this.showMessage(`Error al cargar la plantilla ${templateFile.name}`, 'error');
          return;
        }
        
        try {
          const templateData = JSON.parse(response.content);
          const templateName = templateFile.name.replace('.json', '');
          
          console.log('Plantilla personalizada cargada:', templateName, templateData);
          
          // Usar createDetailsPackageFromTemplate para aplicar fechas correctamente (similar a DETAILS_SYNC)
          this.createDetailsPackageFromTemplate(templateData, dateRange, null);
          
          if (dateRange) {
            this.showMessage(`Plantilla personalizada "${templateName}" cargada exitosamente con fechas aplicadas.`, 'success');
          } else {
            this.showMessage(`Plantilla personalizada "${templateName}" cargada exitosamente.`, 'success');
          }
        } catch (error) {
          console.error('Error al parsear plantilla personalizada:', error);
          this.showMessage(`Error al procesar la plantilla ${templateFile.name}`, 'error');
        }
      },
      error: (error) => {
        console.error('Error al cargar plantilla personalizada:', error);
        this.showMessage(`Error al cargar la plantilla ${templateFile.name}`, 'error');
      }
    });
  }

  /**
   * Aplica valores por defecto para SUMMARY_SYNC
   */
  private applySummarySyncDefaults(cacheData: any, parameters: string[]): void {
    parameters.forEach(param => {
      const paramLower = param.toLowerCase();
      
      // Controlling Area Low: "2000"
      if (paramLower.includes('controlling') && paramLower.includes('area') && paramLower.includes('low')) {
        if (!cacheData[param]) {
          cacheData[param] = '2000';
          console.log(`✓ Aplicado valor por defecto ${param} = 2000`);
        }
      }
      
      // Company Code LOW: "2000"
      if (paramLower.includes('company') && paramLower.includes('code') && paramLower.includes('low') && !paramLower.includes('high')) {
        if (!cacheData[param]) {
          cacheData[param] = '2000';
          console.log(`✓ Aplicado valor por defecto ${param} = 2000`);
        }
      }
      
      // Company Code HIGH: "2100"
      if (paramLower.includes('company') && paramLower.includes('code') && paramLower.includes('high')) {
        if (!cacheData[param]) {
          cacheData[param] = '2100';
          console.log(`✓ Aplicado valor por defecto ${param} = 2100`);
        }
      }
      
      // Profit Center: "2000"
      if (paramLower.includes('profit') && paramLower.includes('center') && !paramLower.includes('category')) {
        if (!cacheData[param]) {
          cacheData[param] = '2000';
          console.log(`✓ Aplicado valor por defecto ${param} = 2000`);
        }
      }
      
      // Cost Element Group Low: "CE_STD"
      if (paramLower.includes('cost') && paramLower.includes('element') && paramLower.includes('group') && paramLower.includes('low')) {
        if (!cacheData[param]) {
          cacheData[param] = 'CE_STD';
          console.log(`✓ Aplicado valor por defecto ${param} = CE_STD`);
        }
      }
      
      // NoSum: true (checked)
      if (param === 'NoSum') {
        if (cacheData[param] === undefined) {
          cacheData[param] = true;
          console.log(`✓ Aplicado valor por defecto NoSum = true`);
        }
      }
      
      // Columns: true (checked)
      if (param === 'Columns') {
        if (cacheData[param] === undefined) {
          cacheData[param] = true;
          console.log(`✓ Aplicado valor por defecto Columns = true`);
        }
      }
    });
  }

  /**
   * Convierte fecha de formato YYYY-MM-DD a DD.MM.YYYY
   */
  private formatDateToDDMMYYYY(dateString: string): string {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  /**
   * Aplica valores por defecto para KSB1
   */
  private applyKSB1Defaults(cacheData: any, parameters: string[]): void {
    console.log('Aplicando valores por defecto para KSB1');
    console.log('Parámetros disponibles:', parameters);
    
    // Valores por defecto según el JSON proporcionado
    const defaults: { [key: string]: any } = {
      'ControllingArea': '2000',
      'CostCenterGroup': '0001',
      'CostElementGroup': 'CE_STD',
      'Layout': '/ALLDETAIL',
      'Columns': ['All'],
      'NoSum': ['All']
    };
    
    // Aplicar valores por defecto buscando coincidencias exactas y por contenido
    parameters.forEach(param => {
      const paramLower = param.toLowerCase();
      
      // Buscar coincidencia exacta primero
      if (defaults[param] !== undefined) {
        if (!cacheData[param]) {
          cacheData[param] = defaults[param];
          console.log(`✓ Aplicado valor por defecto ${param} = ${JSON.stringify(defaults[param])}`);
        }
      } else {
        // Buscar por contenido del nombre
        // ControllingArea
        if ((paramLower.includes('controlling') && paramLower.includes('area')) || param === 'ControllingArea') {
          if (!cacheData[param]) {
            cacheData[param] = '2000';
            console.log(`✓ Aplicado valor por defecto ${param} = 2000`);
          }
        }
        
        // CostCenterGroup
        if ((paramLower.includes('cost') && paramLower.includes('center') && paramLower.includes('group')) || param === 'CostCenterGroup') {
          if (!cacheData[param]) {
            cacheData[param] = '0001';
            console.log(`✓ Aplicado valor por defecto ${param} = 0001`);
          }
        }
        
        // CostElementGroup
        if ((paramLower.includes('cost') && paramLower.includes('element') && paramLower.includes('group')) || param === 'CostElementGroup') {
          if (!cacheData[param]) {
            cacheData[param] = 'CE_STD';
            console.log(`✓ Aplicado valor por defecto ${param} = CE_STD`);
          }
        }
        
        // Layout
        if (paramLower.includes('layout') || param === 'Layout') {
          if (!cacheData[param]) {
            cacheData[param] = '/ALLDETAIL';
            console.log(`✓ Aplicado valor por defecto ${param} = /ALLDETAIL`);
          }
        }
      }
      
      // Columns: ["All"] (array) - siempre aplicar si es undefined o no es array
      if (param === 'Columns') {
        if (cacheData[param] === undefined || !Array.isArray(cacheData[param])) {
          cacheData[param] = ['All'];
          console.log(`✓ Aplicado valor por defecto Columns = ["All"]`);
        }
      }
      
      // NoSum: ["All"] (array) - siempre aplicar si es undefined o no es array
      if (param === 'NoSum') {
        if (cacheData[param] === undefined || !Array.isArray(cacheData[param])) {
          cacheData[param] = ['All'];
          console.log(`✓ Aplicado valor por defecto NoSum = ["All"]`);
        }
      }
    });
    
    console.log('Datos del cache después de aplicar valores por defecto:', cacheData);
  }

  /**
   * Aplica valores por defecto para KOB1
   */
  private applyKOB1Defaults(cacheData: any, parameters: string[]): void {
    console.log('Aplicando valores por defecto para KOB1');
    console.log('Parámetros disponibles:', parameters);
    
    // Valores por defecto según el JSON proporcionado
    const defaults: { [key: string]: any } = {
      'ControllingArea': '2000',
      'OrderLOW': '50000000',
      'Order Low': '50000000',
      'OrderHIGH': '59999999',
      'Order High': '59999999',
      'CostElementGroup': 'CE_STD',
      'Layout': '/ALL_COST',
      'Columns': ['All'],
      'NoSum': ['All']
    };
    
    // Aplicar valores por defecto buscando coincidencias exactas y por contenido
    parameters.forEach(param => {
      const paramLower = param.toLowerCase();
      
      // Buscar coincidencia exacta primero
      if (defaults[param] !== undefined) {
        if (!cacheData[param]) {
          cacheData[param] = defaults[param];
          console.log(`✓ Aplicado valor por defecto ${param} = ${JSON.stringify(defaults[param])}`);
        }
      } else {
        // Buscar por contenido del nombre
        // ControllingArea
        if ((paramLower.includes('controlling') && paramLower.includes('area')) || param === 'ControllingArea') {
          if (!cacheData[param]) {
            cacheData[param] = '2000';
            console.log(`✓ Aplicado valor por defecto ${param} = 2000`);
          }
        }
        
        // OrderLOW
        if ((paramLower.includes('order') && paramLower.includes('low')) && !paramLower.includes('high')) {
          if (!cacheData[param]) {
            cacheData[param] = '50000000';
            console.log(`✓ Aplicado valor por defecto ${param} = 50000000`);
          }
        }
        
        // OrderHIGH
        if ((paramLower.includes('order') && paramLower.includes('high'))) {
          if (!cacheData[param]) {
            cacheData[param] = '59999999';
            console.log(`✓ Aplicado valor por defecto ${param} = 59999999`);
          }
        }
        
        // CostElementGroup
        if ((paramLower.includes('cost') && paramLower.includes('element') && paramLower.includes('group'))) {
          if (!cacheData[param]) {
            cacheData[param] = 'CE_STD';
            console.log(`✓ Aplicado valor por defecto ${param} = CE_STD`);
          }
        }
        
        // Layout
        if (paramLower.includes('layout') || param === 'Layout') {
          if (!cacheData[param]) {
            cacheData[param] = '/ALL_COST';
            console.log(`✓ Aplicado valor por defecto ${param} = /ALL_COST`);
          }
        }
      }
      
      // Columns: ["All"] (array) - siempre aplicar si es undefined o no es array
      if (param === 'Columns') {
        if (cacheData[param] === undefined || !Array.isArray(cacheData[param])) {
          cacheData[param] = ['All'];
          console.log(`✓ Aplicado valor por defecto Columns = ["All"]`);
        }
      }
      
      // NoSum: ["All"] (array) - siempre aplicar si es undefined o no es array
      if (param === 'NoSum') {
        if (cacheData[param] === undefined || !Array.isArray(cacheData[param])) {
          cacheData[param] = ['All'];
          console.log(`✓ Aplicado valor por defecto NoSum = ["All"]`);
        }
      }
    });
    
    console.log('Datos del cache después de aplicar valores por defecto:', cacheData);
  }

  /**
   * Aplica valores por defecto para CJI3_ALLCOST o CJI3_CANDALL
   */
  private applyCJI3Defaults(cacheData: any, parameters: string[], customName: string): void {
    const isAllCost = customName === 'CJI3_ALLCOST';
    const isCandAll = customName === 'CJI3_CANDALL';
    
    console.log(`Aplicando valores por defecto para ${customName}`);
    console.log('Parámetros disponibles:', parameters);
    
    // Valores por defecto según el tipo de CJI3
    const defaults: { [key: string]: any } = {};
    
    if (isAllCost) {
      // Valores por defecto para CJI3_ALLCOST
      Object.assign(defaults, {
        'ControllingArea': '2000',
        'Database prof.': '000000000001',
        'Databaseprof.': '000000000001',
        'ProjectLOW': '2000*',
        'ProjectLow': '2000*',
        'ProjectHIGH': '2100*',
        'ProjectHigh': '2100*',
        'Network/OrderLOW': '2100*',
        'Network/Order Low': '2100*',
        'CostElementGroup': 'CE_STD',
        'Layout': '/ALLCOST',
        'Columns': ['All'],
        'NoSum': ['All']
      });
    } else if (isCandAll) {
      // Valores por defecto para CJI3_CANDALL
      Object.assign(defaults, {
        'ControllingArea': '2000',
        'Database prof.': '000000000001',
        'Databaseprof.': '000000000001',
        'ProjectLOW': '2000-CAP*',
        'ProjectLow': '2000-CAP*',
        'ProjectHIGH': '2100-CAP*',
        'ProjectHigh': '2100-CAP*',
        'CostElementGroup': 'CE_STD',
        'Layout': '/1CANDALL',
        'FurtherSettings': '99999999',
        'Columns': ['All'],
        'NoSum': ['All']
      });
    }
    
    // Aplicar valores por defecto buscando coincidencias exactas y por contenido
    parameters.forEach(param => {
      const paramLower = param.toLowerCase();
      
      // Buscar coincidencia exacta primero
      if (defaults[param] !== undefined) {
        if (!cacheData[param]) {
          cacheData[param] = defaults[param];
          console.log(`✓ Aplicado valor por defecto ${param} = ${JSON.stringify(defaults[param])}`);
        }
      } else {
        // Buscar por contenido del nombre
        // ControllingArea
        if ((paramLower.includes('controlling') && paramLower.includes('area')) || param === 'ControllingArea') {
          if (!cacheData[param]) {
            cacheData[param] = '2000';
            console.log(`✓ Aplicado valor por defecto ${param} = 2000`);
          }
        }
        
        // Database prof.
        if ((paramLower.includes('database') && paramLower.includes('prof')) || param === 'Database prof.' || param === 'Databaseprof.') {
          if (!cacheData[param]) {
            cacheData[param] = '000000000001';
            console.log(`✓ Aplicado valor por defecto ${param} = 000000000001`);
          }
        }
        
        // ProjectLOW
        if ((paramLower.includes('project') && paramLower.includes('low')) && !paramLower.includes('high')) {
          if (!cacheData[param]) {
            cacheData[param] = isAllCost ? '2000*' : (isCandAll ? '2000-CAP*' : '2000*');
            console.log(`✓ Aplicado valor por defecto ${param} = ${cacheData[param]}`);
          }
        }
        
        // ProjectHIGH
        if ((paramLower.includes('project') && paramLower.includes('high'))) {
          if (!cacheData[param]) {
            cacheData[param] = isAllCost ? '2100*' : (isCandAll ? '2100-CAP*' : '2100*');
            console.log(`✓ Aplicado valor por defecto ${param} = ${cacheData[param]}`);
          }
        }
        
        // Network/OrderLOW (solo para CJI3_ALLCOST)
        if (isAllCost && (paramLower.includes('network') || paramLower.includes('order')) && paramLower.includes('low') && !paramLower.includes('high')) {
          if (!cacheData[param]) {
            cacheData[param] = '2100*';
            console.log(`✓ Aplicado valor por defecto ${param} = 2100*`);
          }
        }
        
        // CostElementGroup
        if ((paramLower.includes('cost') && paramLower.includes('element') && paramLower.includes('group'))) {
          if (!cacheData[param]) {
            cacheData[param] = 'CE_STD';
            console.log(`✓ Aplicado valor por defecto ${param} = CE_STD`);
          }
        }
        
        // Layout
        if (paramLower.includes('layout') || param === 'Layout') {
          if (!cacheData[param]) {
            cacheData[param] = isAllCost ? '/ALLCOST' : (isCandAll ? '/1CANDALL' : '/ALLCOST');
            console.log(`✓ Aplicado valor por defecto ${param} = ${cacheData[param]}`);
          }
        }
        
        // FurtherSettings (solo para CJI3_CANDALL)
        if (isCandAll && (paramLower.includes('further') || paramLower.includes('settings') || param === 'FurtherSettings')) {
          if (!cacheData[param]) {
            cacheData[param] = '99999999';
            console.log(`✓ Aplicado valor por defecto ${param} = 99999999`);
          }
        }
      }
      
      // Columns: ["All"] (array) - siempre aplicar si es undefined o no es array
      if (param === 'Columns') {
        if (cacheData[param] === undefined || !Array.isArray(cacheData[param])) {
          cacheData[param] = ['All'];
          console.log(`✓ Aplicado valor por defecto Columns = ["All"]`);
        }
      }
      
      // NoSum: ["All"] (array) - siempre aplicar si es undefined o no es array
      if (param === 'NoSum') {
        if (cacheData[param] === undefined || !Array.isArray(cacheData[param])) {
          cacheData[param] = ['All'];
          console.log(`✓ Aplicado valor por defecto NoSum = ["All"]`);
        }
      }
    });
    
    console.log('Datos del cache después de aplicar valores por defecto:', cacheData);
  }

  /**
   * Aplica las fechas a un formulario individual antes de guardarlo
   */
  private applyDatesToForm(formData: any, dateRange: DateRange, tcode: string, customName: string): any {
    const updatedData: any = { ...formData };
    
    // Determinar si es CJI3, KOB1 o KSB1 para usar formato DD.MM.YYYY
    const isCJI3 = customName.includes('CJI3');
    const isKOB1 = tcode === 'KOB1';
    const isKSB1 = tcode === 'KSB1';
    const needsDDMMYYYY = isCJI3 || isKOB1 || isKSB1;
    
    const dateFormat = needsDDMMYYYY 
      ? this.formatDateForDetailsSync(dateRange.startDate)
      : dateRange.startDate;
    const dateFormatEnd = needsDDMMYYYY 
      ? this.formatDateForDetailsSync(dateRange.endDate)
      : dateRange.endDate;
    
    // Aplicar fechas de posting date
    Object.keys(updatedData).forEach(key => {
      const keyLower = key.toLowerCase();
      
      // Buscar variaciones de "Posting date LOW"
      if ((keyLower.includes('posting') && keyLower.includes('low')) ||
          (keyLower.includes('budat') && keyLower.includes('low'))) {
        updatedData[key] = dateFormat;
      }
      
      // Buscar variaciones de "Posting date HIGH"
      if ((keyLower.includes('posting') && keyLower.includes('high')) ||
          (keyLower.includes('budat') && keyLower.includes('high'))) {
        updatedData[key] = dateFormatEnd;
      }
    });
    
    return updatedData;
  }

  /**
   * Aplica las fechas al paquete antes de guardarlo
   */
  private applyDatesToPackage(packageData: any, dateRange: DateRange, packageName: string): any {
    const periodParam = dateRange.periodType === 'month' 
      ? dateRange.startDate.substring(0, 7) // YYYY-MM
      : `${dateRange.startDate}_${dateRange.endDate}`; // YYYY-MM-DD_YYYY-MM-DD

    const isSummarySync = packageName.toUpperCase().includes('SUMMARY_SYNC');
    
    // Crear una copia del packageData para no modificar el original
    const updatedData: any = {};
    
    Object.keys(packageData).forEach(formName => {
      const formData = { ...packageData[formName] };
      
      // Aplicar período si es SUMMARY_SYNC
      if (isSummarySync) {
        if (formData.period !== undefined) {
          formData.period = periodParam;
        }
        if (formData.periodType !== undefined) {
          formData.periodType = 'month';
        }
      }
      
      // Aplicar fechas de posting date para DETAILS_SYNC
      if (!isSummarySync) {
        // Determinar si es CJI3, KOB1 o KSB1 para usar formato DD.MM.YYYY
        const isCJI3 = formName.toUpperCase().includes('CJI3');
        const isKOB1 = formName.toUpperCase().includes('KOB1');
        const isKSB1 = formName.toUpperCase().includes('KSB1');
        const needsDDMMYYYY = isCJI3 || isKOB1 || isKSB1;
        const dateFormat = needsDDMMYYYY 
          ? this.formatDateToDDMMYYYY(dateRange.startDate)
          : dateRange.startDate;
        const dateFormatEnd = needsDDMMYYYY 
          ? this.formatDateToDDMMYYYY(dateRange.endDate)
          : dateRange.endDate;
        
        Object.keys(formData).forEach(key => {
          const keyLower = key.toLowerCase();
          
          // Buscar variaciones de "Posting date LOW"
          if ((keyLower.includes('posting') && keyLower.includes('low')) ||
              (keyLower.includes('budat') && keyLower.includes('low'))) {
            formData[key] = dateFormat;
          }
          
          // Buscar variaciones de "Posting date HIGH"
          if ((keyLower.includes('posting') && keyLower.includes('high')) ||
              (keyLower.includes('budat') && keyLower.includes('high'))) {
            formData[key] = dateFormatEnd;
          }
        });
      }
      
      updatedData[formName] = formData;
    });
    
    return updatedData;
  }

  /**
   * Maneja la confirmación del rango de fechas
   */
  onDateRangeConfirmed(dateRange: DateRange): void {
    console.log('onDateRangeConfirmed llamado con:', dateRange, 'Tipo pendiente:', this.pendingSyncType);
    
    // Guardar el tipo, el packageId y la plantilla personalizada antes de cerrar el modal
    const syncType = this.pendingSyncType;
    const packageId = this.pendingPackageId;
    const selectedTemplate = this.selectedCustomTemplate;
    this.closeDateRangeModal();

    // Si hay un packageId pendiente, significa que se está guardando un paquete existente
    if (packageId) {
      console.log('Guardando paquete existente con fechas:', packageId);
      this.performSavePackage(packageId, dateRange);
      return;
    }

    // Si no hay packageId, significa que se está creando un nuevo paquete
    if (syncType === 'summary') {
      console.log('Generando SUMMARY_SYNC package...');
      this.generateSummarySyncPackage(dateRange);
    } else if (syncType === 'details') {
      console.log('Generando DETAILS_SYNC package...');
      this.generateDetailsSyncPackage(dateRange);
    } else if (syncType === 'custom' && selectedTemplate) {
      console.log('Generando plantilla personalizada package...');
      this.generateCustomTemplatePackage(selectedTemplate, dateRange);
    } else {
      console.error('Tipo de sincronización no reconocido:', syncType);
    }
  }

  /**
   * Carga la plantilla SUMMARY_SYNC desde sap-query-package y crea una instancia con fechas
   * Flujo: Plantilla guardada (sap-config/sap-query-package$) -> Instancia final (sap-queries$)
   * @param dateRange Si es null, crea la instancia sin fechas. Si tiene valor, aplica las fechas (para instancia final).
   */
  generateSummarySyncPackage(dateRange: DateRange | null): void {
    console.log('generateSummarySyncPackage llamado con:', dateRange);
    const periodParam = dateRange ? dateRange.startDate.substring(0, 7) : null; // YYYY-MM o null
    
    // Cargar la plantilla SUMMARY_SYNC desde sap-query-package
    this.sftpService.listPackages(this.TEMPLATES_DIRECTORY).subscribe({
      next: (response) => {
        if (!response.status || !response.files) {
          this.showMessage('Error al cargar las plantillas desde el servidor SFTP', 'error');
          return;
        }
        
        // Buscar el archivo SUMMARY_SYNC.json
        const templateFile = response.files.find(file => 
          file.name.toLowerCase() === 'summary_sync.json' && !file.isDirectory
        );
        
        if (!templateFile) {
          this.showMessage('No se encontró la plantilla SUMMARY_SYNC.json. Asegúrese de que exista en el Editor de Plantillas.', 'error');
          return;
        }
        
        console.log('Plantilla SUMMARY_SYNC encontrada:', templateFile);
        
        // Cargar el contenido de la plantilla
        this.sftpService.getJsonFileContent(templateFile.path).subscribe({
          next: (fileResponse) => {
            if (!fileResponse.status || !fileResponse.content) {
              this.showMessage('Error al cargar el contenido de la plantilla SUMMARY_SYNC', 'error');
              return;
            }
            
            try {
              const templateData = JSON.parse(fileResponse.content);
              console.log('Plantilla SUMMARY_SYNC cargada:', templateData);
              
              this.createPackageFromTemplate('SUMMARY_SYNC', templateData, dateRange, periodParam);
            } catch (error) {
              console.error('Error al parsear la plantilla SUMMARY_SYNC:', error);
              this.showMessage(`Error al procesar la plantilla: ${error}`, 'error');
            }
          },
          error: (error) => {
            console.error('Error al cargar la plantilla SUMMARY_SYNC:', error);
            this.showMessage('Error al cargar la plantilla desde SFTP', 'error');
          }
        });
      },
      error: (error) => {
        console.error('Error al listar plantillas:', error);
        this.showMessage('Error al conectar con el servidor SFTP para cargar plantillas', 'error');
      }
    });
  }

  /**
   * Crea un paquete desde una plantilla cargada, aplicando fechas si se proporcionan
   */
  private createPackageFromTemplate(
    templateName: string, 
    templateData: any, 
    dateRange: DateRange | null, 
    periodParam: string | null
  ): void {
    const packageId = `pkg_${this.packageIdCounter++}`;
    const forms: Form[] = [];
    
    // La plantilla tiene estructura: { FormName: { tcode, param1, param2, ... } }
    Object.keys(templateData).forEach((formName) => {
      const formData = templateData[formName];
      
      if (typeof formData !== 'object' || formData === null || Array.isArray(formData)) {
        console.warn(`FormData para ${formName} no es válido, saltando...`);
        return;
      }
      
      const tcode = formData.tcode || '';
      
      // Extraer parámetros (todas las claves excepto tcode)
      const parameters = Object.keys(formData).filter(key => key !== 'tcode');
      
      // Agregar Columns y NoSum si no están presentes
      const parametersSet = new Set<string>(parameters);
      if (!parametersSet.has('Columns')) {
        parametersSet.add('Columns');
      }
      if (!parametersSet.has('NoSum')) {
        parametersSet.add('NoSum');
      }
      const allParameters: string[] = Array.from(parametersSet);
      
      const formId = `form_${this.formIdCounter++}`;
      
      // Preparar datos del cache con valores de la plantilla
      const cacheData: any = { ...formData };
      
      // Aplicar fechas si se proporcionaron
      if (periodParam && templateName === 'SUMMARY_SYNC') {
        // Formato YYYYMM para campos de período fiscal
        const periodYYYYMM = periodParam.replace('-', ''); // YYYY-MM -> YYYYMM
        
        // Buscar y actualizar campos de período fiscal
        allParameters.forEach(param => {
          const paramLower = param.toLowerCase();
          
          if (paramLower.includes('fiscal') && paramLower.includes('period') && paramLower.includes('actual')) {
            cacheData[param] = periodYYYYMM;
            console.log(`✓ Actualizado ${param} con ${periodYYYYMM}`);
          }
          
          if (paramLower.includes('forecast') && paramLower.includes('period')) {
            cacheData[param] = periodYYYYMM;
            console.log(`✓ Actualizado ${param} con ${periodYYYYMM}`);
          }
        });
      }
      
      // Crear jsonData básico para el formulario
      const jsonData = {
        $meta: {
          tcode: tcode,
          description: formName
        }
      };
      
      const form: Form = {
        id: formId,
        tcode: tcode,
        customName: formName,
        jsonData: jsonData,
        parameters: allParameters
      };
      
      forms.push(form);
      this.formDataCache[formId] = cacheData;
    });
    
    if (forms.length === 0) {
      this.showMessage('La plantilla no contiene formularios válidos', 'error');
      return;
    }
    
    const newPackage: Package = {
      id: packageId,
      name: periodParam ? `${templateName}_${periodParam.replace('-', '_')}` : templateName,
      forms: forms
    };
    
    this.packages.push(newPackage);
    this.cdr.detectChanges();
    this.selectPackage(packageId);
    this.saveToHistory();
    
    setTimeout(() => {
      this.cdr.detectChanges();
      if (forms.length > 0 && forms[0].parameters.length > 0) {
        const firstForm = forms[0];
        const formElement = document.getElementById(`form_${firstForm.id}`);
        if (!formElement || formElement.children.length === 0) {
          this.generateForm(firstForm.id, firstForm.parameters);
        }
        setTimeout(() => {
          this.restoreFormData(firstForm.id);
          this.cdr.detectChanges();
        }, 100);
      }
      this.showMessage(
        periodParam 
          ? `Paquete ${templateName} creado exitosamente para el período ${periodParam}` 
          : `Paquete ${templateName} cargado desde plantilla`,
        'success'
      );
    }, 300);
  }

  /**
   * Carga la plantilla DETAILS_SYNC desde sap-query-package y crea una instancia con fechas
   * Flujo: Plantilla guardada (sap-config/sap-query-package$) -> Instancia final (sap-queries$)
   * @param dateRange Si es null, crea la instancia sin fechas. Si tiene valor, aplica las fechas (para instancia final).
   */
  generateDetailsSyncPackage(dateRange: DateRange | null): void {
    console.log('generateDetailsSyncPackage llamado con:', dateRange);
    const periodParam = dateRange 
      ? (dateRange.periodType === 'month' 
          ? dateRange.startDate.substring(0, 7) // YYYY-MM
          : `${dateRange.startDate}_${dateRange.endDate}`) // YYYY-MM-DD_YYYY-MM-DD
      : null;

    // Cargar la plantilla DETAILS_SYNC desde sap-query-package
    this.sftpService.listPackages(this.TEMPLATES_DIRECTORY).subscribe({
      next: (response) => {
        if (!response.status || !response.files) {
          this.showMessage('Error al cargar las plantillas desde el servidor SFTP', 'error');
          return;
        }
        
        // Buscar el archivo DETAILS_SYNC.json
        const templateFile = response.files.find(file => 
          file.name.toLowerCase() === 'details_sync.json' && !file.isDirectory
        );
        
        if (!templateFile) {
          this.showMessage('No se encontró la plantilla DETAILS_SYNC.json. Asegúrese de que exista en el Editor de Plantillas.', 'error');
          return;
        }
        
        console.log('Plantilla DETAILS_SYNC encontrada:', templateFile);
        
        // Cargar el contenido de la plantilla
        this.sftpService.getJsonFileContent(templateFile.path).subscribe({
          next: (fileResponse) => {
            if (!fileResponse.status || !fileResponse.content) {
              this.showMessage('Error al cargar el contenido de la plantilla DETAILS_SYNC', 'error');
              return;
            }
            
            try {
              const templateData = JSON.parse(fileResponse.content);
              console.log('Plantilla DETAILS_SYNC cargada:', templateData);
              
              this.createDetailsPackageFromTemplate(templateData, dateRange, periodParam);
            } catch (error) {
              console.error('Error al parsear la plantilla DETAILS_SYNC:', error);
              this.showMessage(`Error al procesar la plantilla: ${error}`, 'error');
            }
          },
          error: (error) => {
            console.error('Error al cargar la plantilla DETAILS_SYNC:', error);
            this.showMessage('Error al cargar la plantilla desde SFTP', 'error');
          }
        });
      },
      error: (error) => {
        console.error('Error al listar plantillas:', error);
        this.showMessage('Error al conectar con el servidor SFTP para cargar plantillas', 'error');
      }
    });
  }

  /**
   * Crea un paquete DETAILS_SYNC desde una plantilla cargada, aplicando fechas si se proporcionan
   */
  private createDetailsPackageFromTemplate(
    templateData: any, 
    dateRange: DateRange | null, 
    periodParam: string | null
  ): void {
    const packageId = `pkg_${this.packageIdCounter++}`;
    const forms: Form[] = [];
    
    // La plantilla tiene estructura: { FormName: { tcode, param1, param2, ... } }
    Object.keys(templateData).forEach((formName) => {
      const formData = templateData[formName];
      
      if (typeof formData !== 'object' || formData === null || Array.isArray(formData)) {
        console.warn(`FormData para ${formName} no es válido, saltando...`);
        return;
      }
      
      const tcode = formData.tcode || '';
      
      // Extraer parámetros (todas las claves excepto tcode)
      const parameters = Object.keys(formData).filter(key => key !== 'tcode');
      
      // Agregar Columns y NoSum si no están presentes
      const parametersSet = new Set<string>(parameters);
      if (!parametersSet.has('Columns')) {
        parametersSet.add('Columns');
      }
      if (!parametersSet.has('NoSum')) {
        parametersSet.add('NoSum');
      }
      // Agregar FurtherSettings para CJI3_CANDALL si no está presente
      if (formName === 'CJI3_CANDALL' && !parametersSet.has('FurtherSettings')) {
        parametersSet.add('FurtherSettings');
      }
      const allParameters: string[] = Array.from(parametersSet);
      
      const formId = `form_${this.formIdCounter++}`;
      
      // Preparar datos del cache con valores de la plantilla
      const cacheData: any = { ...formData };
      
      // Aplicar fechas si se proporcionaron
      if (dateRange) {
        // Formato de fecha para CJI3, KOB1 y KSB1: DD.MM.YYYY
        const needsDDMMYYYY = formName === 'CJI3_ALLCOST' || formName === 'CJI3_CANDALL' || 
                              formName === 'KOB1' || formName === 'KSB1';
        const dateFormat = needsDDMMYYYY
          ? this.formatDateToDDMMYYYY(dateRange.startDate)
          : dateRange.startDate;
        const dateFormatEnd = needsDDMMYYYY
          ? this.formatDateToDDMMYYYY(dateRange.endDate)
          : dateRange.endDate;
        
        console.log(`Aplicando fechas a ${formName}: ${dateFormat} - ${dateFormatEnd}`);
        
        // Buscar y actualizar campos de Posting date LOW y HIGH
        allParameters.forEach(param => {
          const paramLower = param.toLowerCase();
          
          // Buscar variaciones de "Posting date LOW" o "PostingDateLOW"
          if ((paramLower.includes('posting') && paramLower.includes('low') && !paramLower.includes('high')) || 
              param === 'PostingDateLOW' || param === 'Posting date LOW' || param === 'PostingDate Low') {
            cacheData[param] = dateFormat;
            console.log(`✓ Actualizado ${param} con ${dateFormat}`);
          }
          
          // Buscar variaciones de "Posting date HIGH" o "PostingDateHIGH"
          if ((paramLower.includes('posting') && paramLower.includes('high')) || 
              param === 'PostingDateHIGH' || param === 'Posting date HIGH' || param === 'PostingDate High') {
            cacheData[param] = dateFormatEnd;
            console.log(`✓ Actualizado ${param} con ${dateFormatEnd}`);
          }
          
          // También buscar variaciones técnicas comunes
          if (paramLower.includes('budat') && paramLower.includes('low') && !paramLower.includes('high')) {
            cacheData[param] = dateFormat;
            console.log(`✓ Actualizado ${param} con ${dateFormat}`);
          }
          
          if (paramLower.includes('budat') && paramLower.includes('high')) {
            cacheData[param] = dateFormatEnd;
            console.log(`✓ Actualizado ${param} con ${dateFormatEnd}`);
          }
        });
        
        console.log('Datos del cache después de aplicar fechas:', cacheData);
      }
      
      // Crear jsonData básico para el formulario
      const jsonData = {
        $meta: {
          tcode: tcode,
          description: formName
        }
      };
      
      const form: Form = {
        id: formId,
        tcode: tcode,
        customName: formName,
        jsonData: jsonData,
        parameters: allParameters
      };
      
      forms.push(form);
      this.formDataCache[formId] = cacheData;
    });
    
    if (forms.length === 0) {
      this.showMessage('La plantilla no contiene formularios válidos', 'error');
      return;
    }
    
    const newPackage: Package = {
      id: packageId,
      name: periodParam ? `DETAILS_SYNC_${periodParam.replace(/-/g, '_')}` : 'DETAILS_SYNC',
      forms: forms
    };
    
    this.packages.push(newPackage);
    this.cdr.detectChanges();
    this.selectPackage(packageId);
    this.saveToHistory();
    
    setTimeout(() => {
      this.cdr.detectChanges();
      // Generar y restaurar datos para todos los formularios
      forms.forEach(form => {
        if (form.parameters.length > 0) {
          const formElement = document.getElementById(`form_${form.id}`);
          if (!formElement || formElement.children.length === 0) {
            console.log(`Generando formulario para ${form.customName}...`);
            this.generateForm(form.id, form.parameters);
          }
          // Restaurar datos (esto prellenará los campos de fecha)
          setTimeout(() => {
            this.restoreFormData(form.id);
          }, 100);
        }
      });
      const periodInfo = dateRange 
        ? (dateRange.periodType === 'month' 
            ? ` para el período ${periodParam}` 
            : ` para el período ${dateRange.startDate} - ${dateRange.endDate}`)
        : '';
      this.showMessage(
        `Paquete DETAILS_SYNC creado exitosamente con ${forms.length} formularios${periodInfo}`,
        'success'
      );
    }, 200);
  }
  
  /**
   * Convierte los datos del log a string
   */
  getLogDataString(data: any): string {
    if (!data) return '';
    try {
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return String(data);
    }
  }

  /**
   * Agrega un log de ejecución
   */
  addExecutionLog(type: 'info' | 'success' | 'error' | 'warning', message: string, data?: any): void {
    const log: ExecutionLog = {
      timestamp: new Date(),
      type,
      message,
      data: data || {}
    };
    this.executionLogs.unshift(log);
    // Mantener solo los últimos 200 logs
    if (this.executionLogs.length > 200) {
      this.executionLogs = this.executionLogs.slice(0, 200);
    }
  }

  /**
   * Limpia los logs de ejecución
   */
  clearExecutionLogs(): void {
    this.executionLogs = [];
  }

  /**
   * Exporta los logs de ejecución
   */
  exportExecutionLogs(): void {
    const logsText = this.executionLogs.map(log => {
      const dataStr = this.getLogDataString(log.data);
      return `[${log.timestamp.toLocaleString()}] ${log.type.toUpperCase()}: ${log.message}${dataStr ? '\n  Data: ' + dataStr : ''}`;
    }).join('\n\n');
    
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `execution-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  /**
   * Alterna el panel de ejecución
   */
  toggleExecutionPanel(): void {
    this.showExecutionPanel = !this.showExecutionPanel;
  }

  /**
   * Obtiene la duración de la ejecución
   */
  getExecutionDuration(): number {
    if (!this.executionStartTime) return 0;
    const endTime = this.executionEndTime || new Date();
    return endTime.getTime() - this.executionStartTime.getTime();
  }

  /**
   * Formatea la duración en milisegundos a string legible
   */
  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Actualiza el estado de un step de ejecución
   */
  updateStepStatus(stepId: string, status: 'pending' | 'executing' | 'completed' | 'error', data?: any): void {
    const step = this.executionSteps.find(s => s.id === stepId);
    if (step) {
      step.status = status;
      if (data) {
        step.data = { ...step.data, ...data };
      }
    }
  }

  /**
   * Obtiene el conteo de steps completados
   */
  getCompletedStepsCount(): number {
    return this.executionSteps.filter(s => s.status === 'completed').length;
  }

  /**
   * Obtiene el conteo de steps con error
   */
  getErrorStepsCount(): number {
    return this.executionSteps.filter(s => s.status === 'error').length;
  }

  /**
   * Inicializa el panel de ejecución
   */
  initializeExecutionPanel(pkg: Package, dateRange: DateRange | null): void {
    this.executionSteps = [];
    this.executionLogs = [];
    this.isExecuting = false;
    this.executionStartTime = null;
    this.executionEndTime = null;
    this.executionResult = null;
    this.showExecutionPanel = true;
  }

  /**
   * Finaliza la ejecución y muestra el resumen
   */
  finishExecution(savedFiles: string[], failedFiles: string[]): void {
    this.isExecuting = false;
    this.executionEndTime = new Date();
    this.executionResult = {
      success: savedFiles.length,
      errors: failedFiles.length,
      total: savedFiles.length + failedFiles.length
    };
    
    const duration = this.getExecutionDuration();
    this.addExecutionLog('info', `Ejecución finalizada: ${savedFiles.length} exitoso(s), ${failedFiles.length} error(es)`, {
      duration,
      savedFiles,
      failedFiles
    });
    
    // Mostrar popup de éxito/error
    if (failedFiles.length === 0) {
      this.showSuccessPopup(savedFiles, failedFiles);
    } else {
      this.showMessage(`Se guardaron ${savedFiles.length} archivo(s) exitosamente, pero ${failedFiles.length} fallaron.`, 'error');
    }
  }

}

