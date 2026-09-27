const materialsTableBody = document.querySelector('#publicMaterialsTable tbody');
const materialsStatus = document.getElementById('publicMaterialsStatus');

function materialDownloadUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

async function loadPublicMaterials() {
  try {
    const response = await fetch('/api/exam-materials/public');
    if (!response.ok) throw new Error('Unable to load materials');

    const data = await response.json();
    const items = data.items || [];
    materialsTableBody.replaceChildren();

    items.forEach(item => {
      const row = document.createElement('tr');
      const values = [item.sr_no, item.paper_name || '—', item.material_name, item.keywords || '—'];
      values.forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });

      const linkCell = document.createElement('td');
      const downloadUrl = materialDownloadUrl(item.download_url);
      if (downloadUrl) {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open material';
        linkCell.appendChild(link);
      } else {
        linkCell.textContent = 'Unavailable';
      }
      row.appendChild(linkCell);
      materialsTableBody.appendChild(row);
    });

    materialsStatus.textContent = items.length
      ? `${items.length} material${items.length === 1 ? '' : 's'} available`
      : 'No exam materials are available right now.';
  } catch {
    materialsStatus.textContent = 'Exam materials are temporarily unavailable.';
  }
}

loadPublicMaterials();