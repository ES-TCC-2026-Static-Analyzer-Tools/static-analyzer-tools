### Dependencies 
- Install Docker
- Install SonarScanner
- Install Pmd
- Install Node

### Description
## PMD Steps
- Copy pmd-ruleset.xml into project root dir
- Run pmd check script 

## Sonar Steps
- Run sonar server with docker script
- Access localhost:9000
- Configure Projects and Quality Profile
- Run sonar scanner map script
- Run express server script
- Run curl into express server with USER_TOKEN and PROJECT_TOKEN 

### Commands
## Up Sonar Server & Postgre Services
```bash
cd docker
docker compose up -d
```

## Up Express Server
```bash
cd src
node server.js
```

## Map Project In Sonar (project dir)
```bash
sonar-scanner \
  -Dsonar.host.url="http://localhost:9000" \
  -Dsonar.projectKey="PROJECT_KEY" \
  -Dsonar.token="PROJECT_TOKEN" \
  -Dsonar.sources="src" \
  -Dsonar.java.binaries="target/classes"
```

## Scan Pmd With Ruleset (project dir)
```bash
pmd check -d ./src/main/java \
  -R pmd-ruleset.xml \
  -f json \
  -r project_pmd_issues.json
```
