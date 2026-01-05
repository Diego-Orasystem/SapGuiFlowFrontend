import { bootstrapApplication } from '@angular/platform-browser';
import { importProvidersFrom } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';
import { FileSaverModule } from 'ngx-filesaver';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import { AppComponent } from './app/app.component';
import { HomeComponent } from './app/components/home/home.component';
import { SyncPackagesComponent } from './app/components/sync-packages/sync-packages.component';
import { SyncTemplatesEditorComponent } from './app/components/sync-templates-editor/sync-templates-editor.component';
import { SftpExplorerComponent } from './app/components/sftp-explorer/sftp-explorer.component';
import { SchedulerComponent } from './app/components/scheduler/scheduler.component';

const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'sync-packages', component: SyncPackagesComponent },
  { path: 'sync-templates-editor', component: SyncTemplatesEditorComponent },
  { path: 'sftp-explorer', component: SftpExplorerComponent },
  { path: 'scheduler', component: SchedulerComponent },
  { path: '**', redirectTo: '/home' }
];

bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(
      BrowserModule,
      HttpClientModule,
      FormsModule,
      ReactiveFormsModule,
      RouterModule.forRoot(routes),
      MonacoEditorModule.forRoot(),
      FileSaverModule,
      NgbModule
    )
  ]
}).catch(err => console.error(err)); 