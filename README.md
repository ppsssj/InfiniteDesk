# InfiniteDesk

<p align="center">
  <img src="docs/assets/logo-concept.png" alt="InfiniteDesk logo concept" width="320" />
</p>

<p align="center">
  <a href="README_EN.md">English</a> | 한국어
</p>

<p align="center">
  <a href="https://github.com/ppsssj/InfiniteDesk/releases/download/v0.1.0/InfiniteDesk.Setup.0.1.0.exe"><strong>Download InfiniteDesk 0.1.0 for Windows</strong></a>
</p>

InfiniteDesk는 실행 중인 Windows 앱 창을 한 작업 공간에서 보고, 배치하고, 다시 실제 데스크톱에 적용하는 데스크톱 레이아웃 컨트롤러입니다.

여러 앱을 동시에 쓰는 작업 환경에서 창 위치를 매번 다시 맞추지 않고, 자주 쓰는 배치를 Workspace로 저장하고 다시 불러오는 것을 목표로 합니다.

## 다운로드

최신 GitHub Release에서 Windows 설치 파일을 받을 수 있습니다.

- [InfiniteDesk 0.1.0 다운로드](https://github.com/ppsssj/InfiniteDesk/releases/download/v0.1.0/InfiniteDesk.Setup.0.1.0.exe)
- [전체 릴리스 보기](https://github.com/ppsssj/InfiniteDesk/releases)

현재 설치 파일은 코드서명 인증서로 서명되어 있지 않으므로 Windows SmartScreen 또는 보안 경고가 표시될 수 있습니다.

## Demo

![InfiniteDesk demo](docs/video/infinitedesk_demo.gif)

[MP4 데모 영상 보기](docs/video/infinitedesk_demo.mp4)

![InfiniteDesk workspace](docs/assets/workspace-screenshot1.png)

![InfiniteDesk dock and app search](docs/assets/workspace-screenshot2.png)

![InfiniteDesk dark workspace](docs/assets/workspace-screenshot-dark.png)

## 주요 기능

- 현재 열려 있는 Windows 창 목록 스캔
- DWM 기반 실시간 창 미리보기
- 캔버스에서 창 카드 이동 및 배치 편집
- 실제 Windows 창 위치와 크기에 레이아웃 적용
- `Ctrl + Drag` 박스 선택으로 여러 창을 한 번에 선택
- 선택된 창 그룹을 함께 이동
- `Shift + Scroll`로 캔버스 좌우 이동
- 자주 쓰는 창 배치를 Workspace로 저장
- Dock에서 로컬 앱 검색 및 실행
- Mirror Control로 미리보기 영역에서 원본 창 클릭, 드래그, 스크롤 전달
- Native Overlay 모드로 실제 데스크톱 위에 InfiniteDesk를 반투명 컨트롤 레이어처럼 표시

## 사용 방법

1. InfiniteDesk를 실행합니다.
2. `Scan Windows` 또는 `Ctrl + R`로 현재 열려 있는 창을 스캔합니다.
3. 캔버스에서 창 미리보기를 확인하고 원하는 위치로 옮깁니다.
4. 여러 창을 같이 옮기려면 빈 캔버스에서 `Ctrl + Drag`로 창을 선택합니다.
5. 선택된 창 중 하나를 드래그하면 선택된 창 그룹이 함께 움직입니다.
6. `Save Workspace` 또는 `Ctrl + S`로 현재 배치를 저장합니다.
7. `Apply Layout` 또는 `Ctrl + Enter`로 캔버스 배치를 실제 Windows 창에 적용합니다.
8. 필요하면 Native Overlay와 Mirror Control을 사용해 실제 창을 더 직접적으로 조작합니다.

## 개발 실행

### 요구 사항

- Windows
- Node.js 22 이상 권장
- npm

### 설치

```powershell
npm ci
```

### 개발 서버

```powershell
npm run dev
```

### 테스트

```powershell
npm test
```

### Windows 설치 파일 생성

```powershell
npm run package:win
```

생성된 설치 파일은 `release/InfiniteDesk Setup 0.1.0.exe`에 저장됩니다.

## 배포 상태

InfiniteDesk는 현재 초기 릴리스 상태입니다. GitHub Releases를 통해 Windows 설치 파일을 배포합니다.

## 개인정보

InfiniteDesk는 창 제목, 프로세스 이름, 창 위치/크기, DWM 미리보기처럼 민감할 수 있는 로컬 데스크톱 정보를 처리합니다. 현재 버전은 분석 SDK, 광고 SDK, 원격 텔레메트리, 자동 업데이트를 사용하지 않습니다.

자세한 내용은 [PRIVACY.md](PRIVACY.md)를 확인하세요.

## 라이선스

InfiniteDesk 자체 소스 코드, 디자인, 브랜딩, 자산, 문서는 오픈소스 라이선스로 배포되지 않습니다. 자세한 내용은 [NOTICE.md](NOTICE.md)를 확인하세요.

서드파티 오픈소스 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 확인하세요.

