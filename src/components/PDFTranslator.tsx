import { useState } from 'react';
import { Upload, Languages, Download, Globe } from 'lucide-react';

type TranslationStep = 'upload' | 'detect' | 'translate' | 'process' | 'complete';

export default function PDFTranslator() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'completed' | 'error'>('idle');
  const [currentStep, setCurrentStep] = useState<TranslationStep>('upload');
  const [error, setError] = useState<string | null>(null);
  const [translatedFile, setTranslatedFile] = useState<string | null>(null);
  const [mergedFile, setMergedFile] = useState<string | null>(null);
  const [downloadLinks, setDownloadLinks] = useState<string[]>([]);

  const steps: { id: TranslationStep; label: string }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'detect', label: 'Detect Language' },
    { id: 'translate', label: 'Translate' },
    { id: 'process', label: 'Process PDF' },
    { id: 'complete', label: 'Complete' },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setStatus('uploading');
      setCurrentStep('upload');
      // Simulate upload process
      setTimeout(() => {
        setStatus('idle');
      }, 1500);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !targetLanguage) {
      setError('Please upload a PDF file and select a target language.');
      return;
    }

    setError(null);
    setStatus('processing');
    setTranslatedFile(null);
    setMergedFile(null);
    setDownloadLinks([]);

    try {
      // Upload step
      console.log('📄 File uploaded:', file.name);
      console.log('🎯 Target language:', targetLanguage);
      setCurrentStep('upload');

      // Simulate upload delay
      await new Promise(resolve => setTimeout(resolve, 500));

      // Create form data with proper headers
      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('targetLanguage', targetLanguage);
      formData.append('sourceLanguage', 'auto'); // Add source language detection

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

      // Stream the response and process console outputs
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream available');

      let buffer = '';
      let hasCompleted = false;
      let lastStep = 'upload';

      console.log('🔄 Starting to process server response...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('✅ Response stream completed');
          break;
        }

        // Convert the chunk to text and add to buffer
        const chunk = new TextDecoder().decode(value);
        console.log('📥 Received chunk:', chunk);
        buffer += chunk;
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          console.log('📝 Processing line:', trimmedLine);

          // Ensure steps progress in order
          if (trimmedLine.includes('Detecting source language') && lastStep === 'upload') {
            console.log('🔍 Step 1/4: Detecting source language...');
            setCurrentStep('detect');
            lastStep = 'detect';
          } else if (trimmedLine.includes('Starting translation') && lastStep === 'detect') {
            console.log('🔄 Step 2/4: Starting translation process...');
            setCurrentStep('translate');
            lastStep = 'translate';
          } else if (trimmedLine.includes('Processing PDF') && lastStep === 'translate') {
            console.log('⚙️ Step 3/4: Processing PDF...');
            setCurrentStep('process');
            lastStep = 'process';
          } else if (trimmedLine.includes('Translation completed') && lastStep === 'process') {
            console.log('✅ Step 4/4: Translation completed successfully!');
            setCurrentStep('complete');
            lastStep = 'complete';
            hasCompleted = true;
          }

          // Try to parse JSON data if present
          try {
            const jsonData = JSON.parse(trimmedLine);
            if (jsonData.success && jsonData.files) {
              console.log('📦 Received file data:', jsonData);
              setTranslatedFile(jsonData.files.single);
              setMergedFile(jsonData.files.merged);
              setStatus('completed');
              console.log('📦 Files ready for download:');
              console.log('   - Translated PDF:', jsonData.files.single);
              console.log('   - Merged PDF:', jsonData.files.merged);
              if (!hasCompleted) {
                setCurrentStep('complete');
                hasCompleted = true;
              }
            }
          } catch (e) {
            // Not a JSON line, continue
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        console.log('📝 Processing final buffer:', buffer.trim());
        const trimmedLine = buffer.trim();

        // Ensure steps progress in order
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
          hasCompleted = true;
        }

        try {
          const jsonData = JSON.parse(trimmedLine);
          if (jsonData.success && jsonData.files) {
            console.log('📦 Received final file data:', jsonData);
            setTranslatedFile(jsonData.files.single);
            setMergedFile(jsonData.files.merged);
            setStatus('completed');
            if (!hasCompleted) {
              setCurrentStep('complete');
              hasCompleted = true;
            }
          }
        } catch (e) {
          // Not a JSON line, continue
        }
      }

      // If we received files but didn't get completion message, force complete
      if (translatedFile && mergedFile && !hasCompleted) {
        setCurrentStep('complete');
        setStatus('completed');
      }
    } catch (err) {
      console.error('❌ Translation error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred during translation');
      setStatus('error');
    }
  };

  const handleReset = () => {
    setFile(null);
    setTargetLanguage('');
    setStatus('idle');
    setError(null);
    setTranslatedFile(null);
    setMergedFile(null);
    setDownloadLinks([]);
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
              {currentStep === 'upload' && 'File uploaded successfully'}
              {currentStep === 'detect' && 'Verifying reCAPTCHA...'}
              {currentStep === 'translate' && 'Translation in progress...'}
              {currentStep === 'process' && 'Processing PDF with Python...'}
              {currentStep === 'complete' && 'All processes completed!'}
            </div>
          </div>
        )}
        
        <div className="grid gap-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <Download className="h-5 w-5 text-green-400" />
              <h2 className="text-xl font-semibold text-white">Upload PDF</h2>
            </div>
            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-green-700/20 border-dashed rounded-lg hover:border-green-600/40 transition-colors">
              <div className="space-y-1 text-center">
                <Upload className="mx-auto h-12 w-12 text-green-400/60" />
                <div className="flex text-sm text-white/80">
                  <label className="relative cursor-pointer rounded-md font-medium text-green-400 hover:text-green-300 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-green-500">
                    <span>Upload a file</span>
                    <input
                      type="file"
                      className="sr-only"
                      accept=".pdf"
                      onChange={handleFileChange}
                      disabled={status === 'processing' || status === 'completed'}
                    />
                  </label>
                </div>
                <p className="text-xs text-green-400/60">PDF up to 10MB</p>
              </div>
            </div>
            {file && (
              <p className="text-sm text-green-400/80 mt-2">
                Selected: {file.name}
              </p>
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
                disabled={!file || status === 'processing' || status === 'completed'}
                className="block w-full pl-10 pr-3 py-2 bg-green-900/30 border border-green-700/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">Select a language</option>
                <option value="de">German</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
                <option value="nl">Dutch</option>
                <option value="pl">Polish</option>
                <option value="ru">Russian</option>
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
              <span className="ml-3 text-green-400">Processing translation...</span>
            </div>
          )}
          
          {status === 'completed' ? (
            <div className="space-y-4">
              <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4 text-green-200">
                Translation completed successfully!
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {translatedFile && (
                  <button
                    onClick={() => handleDownload(translatedFile)}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium bg-green-600 hover:bg-green-500 text-white shadow-lg hover:shadow-green-600/25 transition-all duration-300"
                  >
                    <Download className="h-5 w-5" />
                    Download Translated PDF
                  </button>
                )}
                {mergedFile && (
                  <button
                    onClick={() => handleDownload(mergedFile)}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium bg-green-600 hover:bg-green-500 text-white shadow-lg hover:shadow-green-600/25 transition-all duration-300"
                  >
                    <Download className="h-5 w-5" />
                    Download Merged PDF
                  </button>
                )}
              </div>
              <button
                onClick={handleReset}
                className="w-full py-3 px-4 rounded-lg font-medium bg-green-600 hover:bg-green-500 text-white shadow-lg hover:shadow-green-600/25 transition-all duration-300"
              >
                Translate Another File
              </button>
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!file || !targetLanguage || status === 'processing'}
              className={`w-full py-3 px-4 rounded-lg font-medium transition-all duration-300 ${
                !file || !targetLanguage || status === 'processing'
                  ? 'bg-green-700/50 text-green-200/50 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-500 text-white shadow-lg hover:shadow-green-600/25'
              }`}
            >
              Translate PDF
            </button>
          )}
        </div>
      </div>
    </div>
  );
}