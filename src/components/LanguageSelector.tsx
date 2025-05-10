import React from 'react';
import { ChevronDown } from 'lucide-react';

interface LanguageSelectorProps {
  value: string;
  onChange: (language: string) => void;
  disabled?: boolean;
}

const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'tr', name: 'Turkish' },
];

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ value, onChange, disabled = false }) => {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full py-3 px-4 pr-10 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-green-400 transition-all duration-300 ${
          disabled
            ? 'bg-green-800/30 text-green-200/70 cursor-not-allowed'
            : 'bg-green-800/50 backdrop-blur-md text-white cursor-pointer hover:bg-green-800/70'
        } border border-green-700/30`}
      >
        <option value="" disabled>
          Select a language
        </option>
        {languages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.name}
          </option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
        <ChevronDown className={`h-5 w-5 ${disabled ? 'text-green-200/50' : 'text-green-400'}`} />
      </div>
    </div>
  );
};

export default LanguageSelector;