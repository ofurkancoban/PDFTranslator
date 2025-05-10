import React, { useCallback, useState } from 'react';
import { Upload, File, X } from 'lucide-react';

interface UploadAreaProps {
  onFileUpload: (file: File) => void;
  file: File | null;
  disabled?: boolean;
}

const UploadArea: React.FC<UploadAreaProps> = ({ onFileUpload, file, disabled = false }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (disabled) return;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf') {
        onFileUpload(droppedFile);
      }
    }
  }, [onFileUpload, disabled]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    
    if (e.target.files && e.target.files.length > 0) {
      onFileUpload(e.target.files[0]);
    }
  }, [onFileUpload, disabled]);

  const handleRemoveFile = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onFileUpload(null as unknown as File);
  }, [onFileUpload]);

  return (
    <div
      className={`relative rounded-xl overflow-hidden transition-all duration-300 ${
        isDragging
          ? 'border-green-400 bg-green-400/10'
          : 'border-green-700/40 bg-green-800/20'
      } ${
        disabled ? 'opacity-70' : 'hover:bg-green-800/30'
      } backdrop-blur-md border-2 border-dashed`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept=".pdf"
        onChange={handleFileChange}
        disabled={disabled}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />
      
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        {file ? (
          <div className="flex items-center gap-3 max-w-full">
            <File className="shrink-0 h-8 w-8 text-green-400" />
            <div className="overflow-hidden">
              <p className="text-white font-medium truncate">{file.name}</p>
              <p className="text-green-300 text-sm">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            {!disabled && (
              <button onClick={handleRemoveFile} className="shrink-0 p-1 hover:bg-green-800/50 rounded-full text-green-400">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="bg-green-700/30 p-3 rounded-full mb-3">
              <Upload className="h-6 w-6 text-green-400" />
            </div>
            <p className="text-white font-medium mb-1">
              Drag & drop your PDF file here
            </p>
            <p className="text-green-300 text-sm">or click to browse</p>
          </>
        )}
      </div>
    </div>
  );
};

export default UploadArea;