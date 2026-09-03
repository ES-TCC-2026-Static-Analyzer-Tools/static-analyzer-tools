const express = require('express');
const app = express();
const PORT = 3000;

// Função genérica para paginação sequencial
async function fetchAllSonarData(endpoint, baseParams, token, arrayKey) {
    let page = 1;
    let totalPages = 1;
    const allResults = [];
    
    // Converte o token para o formato Basic Auth esperado pelo Sonar
    const authHeader = 'Basic ' + Buffer.from(token + ':').toString('base64');

    do {
        baseParams.set('p', page);
        console.log(`Buscando página ${page} de ${totalPages} no endpoint ${endpoint}...`);
        
        const response = await fetch(`http://localhost:9000/api/${endpoint}?${baseParams.toString()}`, {
            headers: { 'Authorization': authHeader }
        });
        const data = await response.json();
        
        // Armazena os dados extraídos (components ou issues)
        if (data[arrayKey]) {
            allResults.push(...data[arrayKey]);
        }

        // Calcula o total de páginas na primeira execução
        if (page === 1) {
            const totalItems = data.paging.total;
            const pageSize = data.paging.pageSize;
            totalPages = Math.ceil(totalItems / pageSize);
        }
        
        page++;
    } while (page <= totalPages);

    return allResults;
}

// Rota 1: Métricas Sumarizadas (Component Tree)
app.get('/metrics/tree', async (req, res) => {
    const { token, projectKey } = req.query;
    const params = new URLSearchParams({
        component: projectKey,
        metricKeys: 'bugs,reliability_rating,software_quality_reliability_issues,code_smells,sqale_rating,sqale_index,software_quality_maintainability_issues,software_quality_maintainability_debt_ratio,vulnerabilities,security_rating,security_hotspots_reviewed,software_quality_security_issues,complexity,cognitive_complexity,ncloc,lines,statements',
        qualifiers: 'FIL',
        q: '.java',
        ps: '500' 
    });

    try {
        const components = await fetchAllSonarData('measures/component_tree', params, token, 'components');
        res.json({ totalExtracted: components.length, components });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota 2: Violações Detalhadas (Issues Search)
app.get('/metrics/issues', async (req, res) => {
    const { token, projectKey } = req.query;
    const params = new URLSearchParams({
        componentKeys: projectKey,
        types: 'BUG,VULNERABILITY,CODE_SMELL',
        ps: '500' 
    });

    try {
        const issues = await fetchAllSonarData('issues/search', params, token, 'issues');
        res.json({ totalExtracted: issues.length, issues });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));