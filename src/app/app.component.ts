import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FlowEditorComponent } from './components/flow-editor/flow-editor.component';
import { FilePreviewComponent } from './components/file-preview/file-preview.component';
import { FileUploadComponent } from './components/file-upload/file-upload.component';
import { ExportToolsComponent } from './components/export-tools/export-tools.component';
import { FileService } from './services/file.service';
import { FlowService } from './services/flow.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    FlowEditorComponent, 
    FilePreviewComponent, 
    FileUploadComponent, 
    ExportToolsComponent
  ]
})
export class AppComponent implements OnInit {
  title = 'SAP GUI Flow Editor';
  sapFlowJson = '';
  isFileUploadSectionOpen = true;
  
  constructor(private fileService: FileService, private flowService: FlowService) {}
  
  ngOnInit(): void {
    // No cargar ningún flujo inicial, dejarlo vacío
    
    // Suscribirse a cambios en el archivo seleccionado
    this.fileService.getSelectedFile().subscribe(file => {
      if (file && file.content) {
        try {
          // Actualizar el JSON para el editor
          this.sapFlowJson = file.content;
          
          // Cargar el flujo en el editor
          this.flowService.importSapFlow(file.content, file.name);
        } catch (error) {
          console.error('Error al actualizar el JSON:', error);
        }
      }
    });
  }
  
  toggleFileUploadSection(): void {
    this.isFileUploadSectionOpen = !this.isFileUploadSectionOpen;
  }
} 