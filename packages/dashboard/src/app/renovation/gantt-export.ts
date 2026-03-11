import html2canvas from 'html2canvas-pro';
import jsPDF from 'jspdf';

export async function exportGanttPdf(scrollContainer: HTMLElement) {
  // Hide toolbar and UI elements during capture
  const hideEls = scrollContainer.querySelectorAll<HTMLElement>('.gantt-print-toolbar');
  hideEls.forEach(el => (el.style.display = 'none'));

  try {
    const canvas = await html2canvas(scrollContainer, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      // Capture only visible area
      width: scrollContainer.clientWidth,
      height: scrollContainer.clientHeight,
      scrollX: -scrollContainer.scrollLeft,
      scrollY: -scrollContainer.scrollTop,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 5;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;

    const imgRatio = canvas.width / canvas.height;
    let w = maxW;
    let h = w / imgRatio;
    if (h > maxH) {
      h = maxH;
      w = h * imgRatio;
    }

    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;
    pdf.addImage(imgData, 'PNG', x, y, w, h);
    const blobUrl = pdf.output('bloburl') as unknown as string;
    window.open(blobUrl, '_blank');
  } finally {
    hideEls.forEach(el => (el.style.display = ''));
  }
}
