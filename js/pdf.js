// ========================================
// PDF.JS - PDF text extraction
// ========================================

async function extractPdfText(file) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('Biblioteca PDF.js não carregou. Recarregue a página.');
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let lastY = null;
    for (const item of content.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 3) {
        lines.push('\n');
      }
      lines.push(item.str);
      lastY = item.transform[5];
    }
    fullText += lines.join(' ') + '\n\n';
  }
  return fullText.trim();
}

async function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  await processFile(file);
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  processFile(file);
}

async function processFile(file) {
  const pasteArea = document.getElementById('pasteArea');
  const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

  if (isPdf) {
    try {
      pasteArea.value = 'Extraindo texto do PDF...';
      const text = await extractPdfText(file);
      if (!text || text.length < 20) {
        pasteArea.value = 'Erro: PDF parece ser uma imagem escaneada ou não contém texto extraível. Tente copiar e colar o conteúdo manualmente.';
        return;
      }
      pasteArea.value = text.slice(0, 30000);
      processarExtrato();
    } catch(err) {
      pasteArea.value = 'Erro ao ler PDF: ' + err.message;
    }
  } else {
    const text = await file.text();
    pasteArea.value = text.slice(0, 30000);
    processarExtrato();
  }
}
