import { Component, OnInit, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SftpService, SftpFile } from '../../services/sftp.service';

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
  imports: [CommonModule, FormsModule]
})
export class SyncPackagesComponent implements OnInit, AfterViewInit {
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

  constructor(
    private cdr: ChangeDetectorRef,
    private sftpService: SftpService
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
  }

  /**
   * Selecciona un archivo JSON desde SFTP y lo carga
   */
  selectJsonFileFromSftp(file: SftpFile): void {
    if (!this.selectedPackageIdForFile) return;

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

    const savedData: any = {};
    
    form.parameters.forEach(param => {
      const paramId = `param_${formId}_${param.replace(/\s+/g, '_')}`;
      
      if (param === 'Columns' || param === 'NoSum') {
        const checkbox = document.getElementById(paramId) as HTMLInputElement;
        if (checkbox) {
          savedData[param] = checkbox.checked;
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
      const paramId = `param_${formId}_${param.replace(/\s+/g, '_')}`;
      
      if (param === 'Columns' || param === 'NoSum') {
        const checkbox = document.getElementById(paramId) as HTMLInputElement;
        if (checkbox && savedData[param] !== undefined) {
          checkbox.checked = savedData[param];
        }
      } else {
        const input = document.getElementById(paramId) as HTMLInputElement;
        if (input && savedData[param] !== undefined) {
          input.value = savedData[param];
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
        fieldDiv.className = 'checkbox-field';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `param_${formId}_${paramId}`;
        checkbox.name = param;
        
        checkbox.addEventListener('change', () => {
          this.saveFormData(formId);
        });
        
        const label = document.createElement('label');
        label.setAttribute('for', `param_${formId}_${paramId}`);
        label.innerHTML = `<span>${param}</span>`;
        
        fieldDiv.appendChild(checkbox);
        fieldDiv.appendChild(label);
      } else {
        fieldDiv.className = 'form-field';
        
        const label = document.createElement('label');
        label.textContent = param;
        label.setAttribute('for', `param_${formId}_${paramId}`);
        
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `param_${formId}_${paramId}`;
        input.name = param;
        input.placeholder = `Ingrese ${param}`;
        
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

    // Guardar datos del formulario actual antes de guardar
    if (this.currentFormId) {
      this.saveFormData(this.currentFormId);
    }

    // Recopilar datos de todos los formularios
    const packageData: any = {};
    
    pkg.forms.forEach(form => {
      const formData = this.collectFormData(form.id);
      packageData[form.customName] = formData;
    });

    // Verificar si el paquete ya existe
    this.sftpService.checkPackageExists(pkg.name).subscribe({
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

        // Llamar al servicio para guardar en SFTP
        this.sftpService.savePackageToSftp(pkg.name, packageData, shouldOverwrite).subscribe({
          next: (response) => {
            if (response.status) {
              this.showMessage(
                `Paquete "${pkg.name}" ${shouldOverwrite ? 'actualizado' : 'guardado'} correctamente en SFTP.${response.fileName ? ` Archivo: ${response.fileName}` : ''}`,
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
        if (confirm(`¿Está seguro de guardar el paquete "${pkg.name}" en el servidor SFTP?`)) {
          this.showMessage('Guardando paquete en servidor SFTP...', 'success');
          this.sftpService.savePackageToSftp(pkg.name, packageData, false).subscribe({
            next: (response) => {
              if (response.status) {
                this.showMessage(
                  `Paquete "${pkg.name}" guardado correctamente en SFTP.${response.fileName ? ` Archivo: ${response.fileName}` : ''}`,
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
   * Carga los paquetes desde el servidor SFTP
   */
  loadPackagesFromSftp(): void {
    this.loadingPackages = true;
    this.sftpService.listPackages().subscribe({
      next: (response) => {
        this.loadingPackages = false;
        if (response.status && response.files && response.files.length > 0) {
          // Cargar cada paquete desde SFTP
          const loadPromises = response.files.map(file => 
            this.loadPackageFromSftp(file)
          );
          
          Promise.all(loadPromises).then(() => {
            if (this.packages.length > 0) {
              this.selectPackage(this.packages[0].id);
            }
            this.saveToHistory();
            this.renderPackages();
          });
        } else {
          // Si no hay paquetes, inicializar los por defecto
          this.initializeDefaultPackages();
        }
      },
      error: (error) => {
        this.loadingPackages = false;
        console.error('Error al cargar paquetes desde SFTP:', error);
        this.showMessage('Error al cargar paquetes desde SFTP. Inicializando paquetes por defecto.', 'error');
        this.initializeDefaultPackages();
      }
    });
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

}

