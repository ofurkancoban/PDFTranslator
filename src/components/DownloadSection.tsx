import React from 'react';
import { Download, RefreshCw } from 'lucide-react';

interface DownloadSectionProps {
  onReset: () => void;
}

const DownloadSection: React.FC<DownloadSectionProps> = ({ onReset }) => {
  const handleDownload = (fileType: 'translated' | 'original') => {
    // In a real application, this would download actual files
    console.log(`Downloading ${fileType} file`);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="p-4 bg-green-700/20 border border-green-600/30 rounded-lg text-center">
        <p className="text-white font-medium mb-1">Translation completed successfully!</p>
        <p className="text-green-300 text-sm">
          Your files are ready to download
        </p>
      </div>
      
      <div className="grid gap-3">
        <button
          onClick={() => handleDownload('translated')}
          className="flex items-center justify-center gap-2 py-3 px-4 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-all duration-300 font-medium"
        >
          <Download className="h-5 w-5" />
          Download Translated PDF
        </button>
        
        <button
          onClick={() => handleDownload('original')}
          className="flex items-center justify-center gap-2 py-3 px-4 bg-green-700/50 hover:bg-green-700/70 text-white rounded-lg transition-all duration-300 font-medium"
        >
          <Download className="h-5 w-5" />
          Download Original with Annotations
        </button>
      </div>
      
      <button
        onClick={onReset}
        className="flex items-center justify-center gap-2 w-full py-2 text-green-300 hover:text-green-200 rounded-lg transition-all duration-300"
      >
        <RefreshCw className="h-4 w-4" />
        <span>Translate another document</span>
      </button>
    </div>
  );
};

export default DownloadSection;