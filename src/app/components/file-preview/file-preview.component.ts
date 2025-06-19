import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FileService } from '../../services/file.service';
import { FlowFile } from '../../models/flow-file.model';
import { take } from 'rxjs/operators';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

declare var bootstrap: any;

@Component({
  selector: 'app-file-preview',
  templateUrl: './file-preview.component.html',
  styleUrls: ['./file-preview.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class FilePreviewComponent implements OnInit {
  files: FlowFile[] = [];
  selectedFile: FlowFile | null = null;
  showPreview = false;
  jsonEditorContent = '';
  jsonModal: any;
  
  constructor(private fileService: FileService) { }

  ngOnInit(): void {
    // Obtener archivos de entrada primero (en caso de usar datos de prueba)
    this.fileService.getInputFiles().subscribe(files => {
      if (files.length > 0 && this.files.length === 0) {
        this.files = files;
      }
    });
    
    // Luego obtener archivos de salida (toman precedencia)
    this.fileService.getOutputFiles().subscribe(files => {
      if (files.length > 0) {
        this.files = files;
      }
    });
    
    this.fileService.getSelectedFile().subscribe(file => {
      this.selectedFile = file;
    });
  }

  selectFile(file: FlowFile): void {
    this.fileService.setSelectedFile(file);
  }

  isSelected(file: FlowFile): boolean {
    return this.selectedFile?.name === file.name;
  }
  
  togglePreview(): void {
    this.showPreview = !this.showPreview;
  }
  
  getFormattedContent(): string {
    if (!this.selectedFile || !this.selectedFile.content) {
      return 'No hay contenido disponible';
    }
    
    try {
      // Si el contenido ya es un objeto JSON, lo formateamos bonito
      if (typeof this.selectedFile.content === 'object') {
        return JSON.stringify(this.selectedFile.content, null, 2);
      }
      
      // Si es una cadena, intentamos parsearlo como JSON para formatearlo
      const parsed = JSON.parse(this.selectedFile.content);
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      // Si no es JSON válido, devolvemos el contenido sin formato
      return this.selectedFile.content;
    }
  }
  
  openJsonModal(): void {
    if (!this.selectedFile || !this.selectedFile.content) return;
    
    // Inicializar el contenido del editor con el JSON formateado
    this.jsonEditorContent = this.getFormattedContent();
    
    // Mostrar el modal usando Bootstrap
    this.jsonModal = new bootstrap.Modal(document.getElementById('jsonEditorModal'));
    this.jsonModal.show();
  }
  
  saveJsonChanges(): void {
    if (!this.selectedFile) return;
    
    try {
      // Validar que el JSON sea válido
      const parsedJson = JSON.parse(this.jsonEditorContent);
      
      // Actualizar el contenido del archivo
      this.selectedFile.content = JSON.stringify(parsedJson);
      
      // Actualizar el archivo en el servicio
      this.fileService.updateFile(this.selectedFile);
      
      // Cerrar el modal
      if (this.jsonModal) {
        this.jsonModal.hide();
      }
    } catch (e) {
      alert('El JSON no es válido. Por favor, corrija los errores antes de guardar.');
    }
  }
  
  processFile(): void {
    if (!this.selectedFile) return;
    
    // Simulamos el procesamiento del archivo seleccionado
    const processedFile: FlowFile = {
      ...this.selectedFile,
      name: this.selectedFile.name.replace('.json', '_processed.json'),
      path: this.selectedFile.path.replace('.json', '_processed.json'),
      size: this.selectedFile.size + 1024 // Simulamos un archivo un poco más grande
    };
    
    // Obtenemos la lista actual de archivos procesados
    this.fileService.getOutputFiles().pipe(take(1)).subscribe(currentFiles => {
      // Creamos una copia de los archivos actuales
      const updatedFiles = [...currentFiles];
      
      // Verificamos si ya existe un archivo con ese nombre
      const existingIndex = updatedFiles.findIndex(f => f.name === processedFile.name);
      if (existingIndex >= 0) {
        updatedFiles[existingIndex] = processedFile;
      } else {
        updatedFiles.push(processedFile);
      }
      
      // Actualizamos los archivos procesados usando la API pública
      // Esto simula el procesamiento de archivos para la demostración
      const updatedProcessedFiles = [...updatedFiles];
      this.fileService['outputFilesSubject'].next(updatedProcessedFiles);
      
      // Seleccionamos el archivo procesado
      this.fileService.setSelectedFile(processedFile);
    });
  }
  
  downloadFile(): void {
    if (!this.selectedFile || !this.selectedFile.content) return;
    
    const blob = new Blob([this.selectedFile.content], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.selectedFile.name;
    a.click();
    window.URL.revokeObjectURL(url);
  }
} 