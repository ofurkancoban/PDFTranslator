# PDF Translator

A web application that translates PDF documents while preserving their original formatting. The application provides both side-by-side comparison and translated-only versions of the documents.

## Features

- PDF file upload and translation
- Automatic language detection
- Side-by-side comparison of original and translated text
- Translated-only version with original formatting
- Modern and responsive UI
- Real-time translation progress tracking

## Prerequisites

- Node.js (v16 or higher)
- Python 3.8 or higher
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd pdf-translator
```

2. Install Node.js dependencies:
```bash
npm install
```

3. Install Python dependencies:
```bash
pip install -r requirements.txt
```

## Running the Application

1. Start the backend server:
```bash
npm run server
```

2. In a separate terminal, start the frontend development server:
```bash
npm run dev
```

3. Open your browser and navigate to `http://localhost:5173`

## Usage

1. Click the upload area or drag and drop a PDF file
2. Select the target language for translation
3. Click "Start Translation"
4. Wait for the translation process to complete
5. Download either the side-by-side comparison or the translated-only version

## File Structure

- `src/` - Frontend React application
  - `components/` - React components
  - `services/` - API services
  - `types/` - TypeScript type definitions
- `server.js` - Express backend server
- `process_translated_pdf.py` - Python script for PDF processing
- `translated/` - Directory for processed PDF files

## Technologies Used

- Frontend:
  - React
  - TypeScript
  - Tailwind CSS
  - Vite
- Backend:
  - Node.js
  - Express
  - Python
  - PyMuPDF

## License

MIT 