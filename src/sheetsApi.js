const SPREADSHEET_ID = '1jG3I_5qZ0pGR8T9xvDAdpPIVTMr_4JWEkXSCMfmQiC4';

export const fetchSheetData = async (accessToken) => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/A1:H`;
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const msg = errorBody?.error?.message || response.statusText;
        throw new Error(`${response.status}: ${msg}`);
    }

    const data = await response.json();
    const rows = data.values || [];

    if (rows.length < 2) return [];

    const headers = rows[0];
    const items = rows.slice(1).map((row, index) => {
        return {
            id: `row-${index + 2}`, // row number as unique ID
            rowIndex: index + 2,
            videoId: row[0] || '',
            format: row[1] || '',
            title: row[2] || '',
            status: row[3] || '',
            scriptLink: row[4] || '',
            notes: row[5] || '',
        };
    });

    return { headers, items };
};

export const updateSheetStatus = async (accessToken, rowIndex, newStatus) => {
    // Column D (index 3) is 'Status'
    const range = `D${rowIndex}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            range,
            majorDimension: 'ROWS',
            values: [[newStatus]],
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to update status in Google Sheets');
    }

    return await response.json();
};
