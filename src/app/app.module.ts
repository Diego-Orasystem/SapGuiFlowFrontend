import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { MonacoEditorModule } from 'ngx-monaco-editor';
import { FileSaverModule } from 'ngx-filesaver';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import { AppComponent } from './app.component';
import { FileUploadComponent } from './components/file-upload/file-upload.component';
import { FlowEditorComponent } from './components/flow-editor/flow-editor.component';
import { FilePreviewComponent } from './components/file-preview/file-preview.component';
import { ExportToolsComponent } from './components/export-tools/export-tools.component';
import { DragDropDirective } from './shared/directives/drag-drop.directive';
import { JsonFormatPipe } from './shared/pipes/json-format.pipe';

const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: AppComponent },
  { path: '**', redirectTo: '/home' }
];

@NgModule({
  imports: [
    BrowserModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule.forRoot(routes),
    MonacoEditorModule.forRoot(),
    FileSaverModule,
    AppComponent,
    FileUploadComponent,
    FlowEditorComponent,
    FilePreviewComponent,
    ExportToolsComponent,
    DragDropDirective,
    JsonFormatPipe
  ],
  providers: []
})
export class AppModule { } 