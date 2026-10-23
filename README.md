# 부산 부흥고 코딩 퀴즈

Python 기초 직접 코딩 문제 300개를 연습 또는 테스트 모드로 풀 수 있는 정적 웹사이트입니다. 난이도와 문항 수를 선택하고, 문제마다 코드를 실행해 출력이나 오류를 확인할 수 있습니다.

## 로컬에서 실행

Node.js 24 이상이 필요합니다.

```bash
npm ci
npm run dev
```

타입 검사와 정적 빌드는 다음 명령으로 실행합니다.

```bash
npm run check
npm run build
npm run preview
```

## GitHub Actions

`main`에 push하거나 `main` 대상 pull request를 열면 GitHub Actions가 의존성을 설치하고 타입 검사와 Vite 정적 빌드를 실행합니다. Vite 설정은 GitHub Actions의 `GITHUB_REPOSITORY` 값을 사용해 저장소 하위 경로용 자산 URL을 자동으로 생성합니다.

## GitHub Pages

저장소에는 빌드 검증 workflow가 포함되어 있지만, GitHub Pages 공개 배포는 아직 설정하지 않았습니다. Pages를 켜면 사이트가 인터넷에 공개됩니다. 실제 배포에는 저장소의 **Settings → Pages → Source → GitHub Actions** 설정과 Pages 배포 workflow가 필요합니다.

- [Vite: Deploying a static site](https://vite.dev/guide/static-deploy)
- [GitHub Pages: Using custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

Python 코드는 브라우저의 Worker에서 실행됩니다. 실행기는 첫 사용 때 Pyodide 모듈을 CDN에서 불러오며, 사용자가 입력한 코드를 서버로 보내지 않습니다. 현재 연습 범위 밖의 `import`, 반복문, 함수 정의 등은 실행할 수 없습니다.
