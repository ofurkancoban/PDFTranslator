import React from 'react';
import PDFTranslator from './components/PDFTranslator';
import AnimatedBackground from './components/AnimatedBackground';

function App() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-green-900 to-green-950">
      <AnimatedBackground />
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4 sm:p-6">
        <PDFTranslator />
      </div>
    </div>
  );
}

export default App;