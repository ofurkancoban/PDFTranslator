import React, { useEffect, useState } from 'react';

const ProcessingStatus: React.FC = () => {
  const [progress, setProgress] = useState(0);
  const steps = [
    'Analyzing PDF document...',
    'Extracting text content...',
    'Preparing for translation...',
    'Translating content...',
    'Generating output files...',
  ];
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev + 1;
        if (newProgress >= 100) {
          clearInterval(interval);
          return 100;
        }
        return newProgress;
      });
    }, 30);

    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= steps.length - 1) {
          clearInterval(stepInterval);
          return prev;
        }
        return prev + 1;
      });
    }, 600);

    return () => {
      clearInterval(interval);
      clearInterval(stepInterval);
    };
  }, [steps.length]);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="relative w-full h-2 bg-green-900/50 rounded-full overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-green-500 to-green-300 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      
      <div className="flex justify-between text-green-300 text-sm">
        <span>Processing</span>
        <span>{progress}%</span>
      </div>
      
      <div className="bg-green-900/30 border border-green-800/40 rounded-lg p-4">
        <p className="text-green-100 animate-pulse">{steps[currentStep]}</p>
      </div>
    </div>
  );
};

export default ProcessingStatus;