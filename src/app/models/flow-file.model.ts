export interface FlowFile {
    name: string;
    path: string;
    size: number;
    modified: Date;
    content: string;
} 