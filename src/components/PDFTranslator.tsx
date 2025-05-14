import { useState } from 'react';
import { Upload, Languages, Download, Globe } from 'lucide-react';
import { languages } from '../data/languages';

type TranslationStep = 'upload' | 'detect' | 'translate' | 'process' | 'complete';

interface FileTranslation {
  file: File;
  status: 'pending' | 'processing' | 'completed' | 'error';
  translatedPath?: string;
  mergedPath?: string;
  error?: string;
}

export default function PDFTranslator() {
  const [files, setFiles] = useState<FileTranslation[]>([]);
  const [targetLanguage, setTargetLanguage] = useState('tr');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'completed' | 'error'>('idle');
  const [currentStep, setCurrentStep] = useState<TranslationStep>('upload');
  const [error, setError] = useState<string | null>(null);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);

  const steps: { id: TranslationStep; label: string }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'detect', label: 'Detect Language' },
    { id: 'translate', label: 'Translate' },
    { id: 'process', label: 'Process PDF' },
    { id: 'complete', label: 'Complete' },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map(file => ({
        file,
        status: 'pending' as const
      }));
      setFiles(newFiles);
      setStatus('idle');
      setCurrentStep('upload');
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length || !targetLanguage) {
      setError('Please upload at least one PDF file and select a target language.');
      return;
    }

    setError(null);
    setStatus('processing');
    setCurrentFileIndex(0);

    for (let i = 0; i < files.length; i++) {
      setCurrentFileIndex(i);
      setFiles(prev => prev.map((f, idx) => 
        idx === i ? { ...f, status: 'processing' } : f
      ));

      try {
        setCurrentStep('upload');
        console.log(`📄 Processing file ${i + 1}/${files.length}:`, files[i].file.name);

        // Create form data
        const formData = new FormData();
        formData.append('pdf', files[i].file);
        formData.append('targetLanguage', targetLanguage);
        formData.append('sourceLanguage', 'auto');

        const response = await fetch('http://localhost:3000/api/translate', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
          },
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Translation failed with status: ${response.status}`);
        }

        // Stream processing
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream available');

        let buffer = '';
        let lastStep = 'upload';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = new TextDecoder().decode(value);
          buffer += chunk;
          
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            // Update steps
            if (trimmedLine.includes('Detecting source language') && lastStep === 'upload') {
              setCurrentStep('detect');
              lastStep = 'detect';
            } else if (trimmedLine.includes('Starting translation') && lastStep === 'detect') {
              setCurrentStep('translate');
              lastStep = 'translate';
            } else if (trimmedLine.includes('Processing PDF') && lastStep === 'translate') {
              setCurrentStep('process');
              lastStep = 'process';
            } else if (trimmedLine.includes('Translation completed') && lastStep === 'process') {
              setCurrentStep('complete');
              lastStep = 'complete';
            }

            // Parse JSON response
            try {
              const jsonData = JSON.parse(trimmedLine);
              if (jsonData.success && jsonData.files) {
                setFiles(prev => prev.map((f, idx) => 
                  idx === i ? { 
                    ...f, 
                    status: 'completed',
                    translatedPath: jsonData.files.single,
                    mergedPath: jsonData.files.merged
                  } : f
                ));
              }
            } catch (e) {
              // Not JSON, continue
            }
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const jsonData = JSON.parse(buffer.trim());
            if (jsonData.success && jsonData.files) {
              setFiles(prev => prev.map((f, idx) => 
                idx === i ? { 
                  ...f, 
                  status: 'completed',
                  translatedPath: jsonData.files.single,
                  mergedPath: jsonData.files.merged
                } : f
              ));
            }
          } catch (e) {
            // Not JSON
          }
        }

        // İstekler arası gecikme
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (err) {
        console.error(`❌ Translation error for file ${i + 1}:`, err);
        setFiles(prev => prev.map((f, idx) => 
          idx === i ? { 
            ...f, 
            status: 'error',
            error: err instanceof Error ? err.message : 'Translation failed'
          } : f
        ));
      }
    }

    setStatus('completed');
    setCurrentStep('complete');
  };

  const handleReset = () => {
    setFiles([]);
    setTargetLanguage('tr');
    setStatus('idle');
    setError(null);
    setCurrentFileIndex(0);
  };

  const handleDownload = async (filePath: string) => {
    try {
      console.log('Attempting to download file:', filePath);
      const response = await fetch(`http://localhost:3000/api/download?file=${encodeURIComponent(filePath)}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath.split('/').pop() || 'downloaded.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
      alert('Error downloading file. Please try again.');
    }
  };

  const allFilesCompleted = files.length > 0 && files.every(f => f.status === 'completed' || f.status === 'error');
  const hasCompletedFiles = files.some(f => f.status === 'completed');

  return (
    <div className="w-full max-w-4xl backdrop-blur-lg bg-green-900/30 rounded-2xl overflow-hidden shadow-2xl border border-green-700/20">
      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <Languages className="text-green-400 h-8 w-8" />
          <h1 className="text-3xl font-bold text-white">PDF Translator</h1>
        </div>
        
        {status === 'processing' && (
          <div className="mb-8">
            <div className="flex justify-between mb-2">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={`flex flex-col items-center ${
                    steps.findIndex((s) => s.id === currentStep) >= steps.findIndex((s) => s.id === step.id)
                      ? 'text-green-400'
                      : 'text-green-400/40'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${
                      steps.findIndex((s) => s.id === currentStep) >= steps.findIndex((s) => s.id === step.id)
                        ? 'bg-green-500'
                        : 'bg-green-500/40'
                    }`}
                  >
                    {steps.findIndex((s) => s.id === currentStep) > steps.findIndex((s) => s.id === step.id) ? (
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="text-white">
                        {steps.findIndex((s) => s.id === step.id) + 1}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-medium">{step.label}</span>
                </div>
              ))}
            </div>
            <div className="relative h-2 bg-green-900/50 rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-green-500 transition-all duration-500 ease-in-out"
                style={{
                  width: `${((steps.findIndex((s) => s.id === currentStep) + 1) / steps.length) * 100}%`,
                }}
              />
            </div>
            <div className="mt-2 text-sm text-green-400/80 text-center">
              {currentStep === 'upload' && `Processing file ${currentFileIndex + 1} of ${files.length}...`}
              {currentStep === 'detect' && `Detecting language for file ${currentFileIndex + 1}...`}
              {currentStep === 'translate' && `Translating file ${currentFileIndex + 1}...`}
              {currentStep === 'process' && `Processing PDF ${currentFileIndex + 1}...`}
              {currentStep === 'complete' && 'All files processed!'}
            </div>
          </div>
        )}
        
        <div className="grid gap-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <Download className="h-5 w-5 text-green-400" />
              <h2 className="text-xl font-semibold text-white">Upload PDFs</h2>
            </div>
            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-green-700/20 border-dashed rounded-lg hover:border-green-600/40 transition-colors">
              <div className="space-y-1 text-center">
                <Upload className="mx-auto h-12 w-12 text-green-400/60" />
                <div className="flex text-sm text-white/80">
                  <label className="relative cursor-pointer rounded-md font-medium text-green-400 hover:text-green-300 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-green-500">
                    <span>Upload files</span>
                    <input
                      type="file"
                      className="sr-only"
                      accept=".pdf"
                      multiple
                      onChange={handleFileChange}
                      disabled={status === 'processing'}
                    />
                  </label>
                </div>
                <p className="text-xs text-green-400/60">Multiple PDFs up to 10MB each</p>
              </div>
            </div>
            
            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium text-green-400">Selected files:</p>
                {files.map((fileObj, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-green-900/20 rounded-lg border border-green-700/20">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${
                        fileObj.status === 'completed' ? 'bg-green-500' :
                        fileObj.status === 'processing' ? 'bg-yellow-500' :
                        fileObj.status === 'error' ? 'bg-red-500' :
                        'bg-gray-500'
                      }`} />
                      <span className="text-sm text-white">{fileObj.file.name}</span>
                    </div>
                    {status !== 'processing' && (
                      <button
                        onClick={() => removeFile(index)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="h-5 w-5 text-green-400" />
              <h2 className="text-xl font-semibold text-white">Select Target Language</h2>
            </div>
            <div className="mt-1 relative rounded-lg">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Languages className="h-5 w-5 text-green-400/60" />
              </div>
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                disabled={!files.length || status === 'processing' || status === 'completed'}
                className="block w-full pl-10 pr-3 py-2 bg-green-900/30 border border-green-700/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">Select a language</option>
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          {error && (
            <div className="py-2 px-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-200">
              {error}
            </div>
          )}
          
          {status === 'processing' && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400"></div>
              <span className="ml-3 text-green-400">Processing translations...</span>
            </div>
          )}
          
          {allFilesCompleted && hasCompletedFiles ? (
            <div className="space-y-4">
              <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4 text-green-200">
                Translation completed for {files.filter(f => f.status === 'completed').length} of {files.length} files
              </div>
              <div className="space-y-3">
                {files.map((fileObj, index) => 
                  fileObj.status === 'completed' && (
                    <div key={index} className="p-4 bg-green-900/20 rounded-lg border border-green-700/20">
                      <p className="text-sm text-green-400 mb-3">{fileObj.file.name}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {fileObj.translatedPath && (
                          <button
                            onClick={() => handleDownload(fileObj.translatedPath!)}
                            className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-medium bg-green-600 hover:bg-green-500 text-white text-sm"
                          >
                            <Download className="h-4 w-4" />
                            Download Translated
                          </button>
                        )}
                        {fileObj.mergedPath && (
                          <button
                            onClick={() => handleDownload(fileObj.mergedPath!)}
                            className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-medium bg-green-600 hover:bg-green-500 text-white text-sm"
                          >
                            <Download className="h-4 w-4" />
                            Download Merged
                          </button>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
              <button
                onClick={handleReset}
                className="w-full py-3 px-4 rounded-lg font-medium bg-green-600 hover:bg-green-500 text-white shadow-lg hover:shadow-green-600/25 transition-all duration-300"
              >
                Translate More Files
              </button>
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!files.length || !targetLanguage || status === 'processing'}
              className={`w-full py-3 px-4 rounded-lg font-medium transition-all duration-300 ${
                !files.length || !targetLanguage || status === 'processing'
                  ? 'bg-green-700/50 text-green-200/50 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-500 text-white shadow-lg hover:shadow-green-600/25'
              }`}
            >
              Translate {files.length} PDF{files.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}