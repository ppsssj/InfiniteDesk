# InfiniteDesk

<p align="center">
  <img src="docs/assets/logo-concept.png" alt="InfiniteDesk logo concept" width="320" />
</p>

<p align="center">
  <a href="README_EN.md">English</a> | 한국어
</p>

<p align="center">
  <a href="https://github.com/ppsssj/InfiniteDesk/releases/download/v0.1.0/InfiniteDesk.Setup.0.1.0.exe"><strong>Windows용 InfiniteDesk 0.1.0 다운로드</strong></a>
</p>

InfiniteDesk는 실행 중인 Windows 앱 창을 하나의 캔버스에서 확인하고 배치한 뒤, 그 배치를 실제 데스크톱 창에 다시 적용하는 데스크톱 레이아웃 컨트롤러입니다.

여러 앱을 동시에 열어두고 작업할 때 창 위치를 매번 다시 맞추지 않도록, 자주 쓰는 배치를 Workspace로 저장하고 필요한 순간에 다시 불러오는 것을 목표로 합니다.

## 다운로드

Windows 설치 파일은 GitHub Releases에서 받을 수 있습니다.

- [InfiniteDesk 0.1.0 다운로드](https://github.com/ppsssj/InfiniteDesk/releases/download/v0.1.0/InfiniteDesk.Setup.0.1.0.exe)
- [전체 릴리스 보기](https://github.com/ppsssj/InfiniteDesk/releases)

현재 설치 파일은 코드 서명이 되어 있지 않으므로 Windows SmartScreen 또는 보안 경고가 표시될 수 있습니다.

## Demo

![InfiniteDesk demo](docs/video/infinitedesk_demo.gif)

[MP4 데모 영상 보기](docs/video/infinitedesk_demo.mp4)

![InfiniteDesk workspace](docs/assets/workspace-screenshot1.png)

![InfiniteDesk dock and app search](docs/assets/workspace-screenshot2.png)

![InfiniteDesk dark workspace](docs/assets/workspace-screenshot-dark.png)

## 주요 기능

- 현재 열려 있는 Windows 앱 창 스캔
- 최소화된 창을 포함한 실행 중인 창 탐지
- DWM 기반 실시간 창 미리보기
- 캔버스에서 창 카드 이동 및 배치 편집
- 캔버스 배치를 실제 Windows 창 위치와 크기에 적용
- `Ctrl + Drag`로 여러 창 선택
- 선택한 창 그룹을 함께 이동
- `Shift + Scroll`로 캔버스 좌우 이동
- 자주 쓰는 창 배치를 Workspace로 저장
- Dock에서 로컬 앱 검색, 고정, 실행
- 기본 Dock 앱 고정 해제 및 다시 고정
- 빈 캔버스 우클릭 위치에서 앱 실행
- Quick Launch preview로 실행 중인 창을 사이드 패널에 임시 고정
- Quick Launch 패널 드래그, 크기 조절, 좌우 사이드 스냅
- Mirror Control로 미리보기 영역에서 원본 창에 클릭, 드래그, 스크롤 전달
- Native Overlay 모드로 실제 데스크톱 위에 InfiniteDesk 컨트롤 레이어 표시

## Quick Launch Preview

Quick Launch preview는 작업 중 계속 보고 싶은 실행 창을 화면 좌우 사이드 패널에 임시로 고정하는 기능입니다.

- 캔버스의 창 카드에서 우클릭 후 `Pin to Quick Launch`를 선택합니다.
- Quick Launch로 보낸 창은 캔버스에서 숨겨지고, Quick Launch에서 제거하면 원래 캔버스 위치로 돌아옵니다.
- 패널은 드래그로 위치를 바꿀 수 있고, 크기도 조절할 수 있습니다.
- 패널을 중앙으로 옮기면 가까운 좌우 사이드로 부드럽게 스냅됩니다.
- Quick Launch 항목은 현재 실행 세션에서만 유지됩니다. InfiniteDesk를 종료 후 다시 실행하면 복원되지 않습니다.

YouTube 같은 영상 창은 브라우저의 GPU 렌더링, 최소화 상태, 보호 콘텐츠 정책에 따라 DWM 미리보기가 끊기거나 검게 보일 수 있습니다. 영상 감상 용도에서는 원본 브라우저 창을 최소화하지 않는 것이 더 안정적입니다.

## 사용 방법

1. InfiniteDesk를 실행합니다.
2. `Scan Windows` 또는 `Ctrl + R`로 현재 열려 있는 창을 스캔합니다.
3. 캔버스에서 창 미리보기를 확인하고 원하는 위치로 옮깁니다.
4. 여러 창을 함께 옮기려면 빈 캔버스에서 `Ctrl + Drag`로 창을 선택합니다.
5. 선택한 창 중 하나를 드래그하면 선택 그룹이 함께 이동합니다.
6. 빈 캔버스에서 우클릭하면 해당 좌표에 앱을 실행할 수 있습니다.
7. 창 카드에서 우클릭하면 Quick Launch 고정, 실제 창 열기, 캔버스 제거, 실제 창 닫기 등을 사용할 수 있습니다.
8. `Save Workspace` 또는 `Ctrl + S`로 현재 배치를 저장합니다.
9. `Apply Layout` 또는 `Ctrl + Enter`로 캔버스 배치를 실제 Windows 창에 적용합니다.

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

InfiniteDesk는 현재 초기 릴리스 상태입니다. Windows 설치 파일은 GitHub Releases를 통해 배포합니다.

## 개인정보

InfiniteDesk는 창 제목, 프로세스 이름, 창 위치와 크기, DWM 미리보기처럼 로컬 데스크톱 정보를 처리합니다. 현재 버전은 분석 SDK, 광고 SDK, 원격 텔레메트리, 자동 업데이트를 사용하지 않습니다.

자세한 내용은 [PRIVACY.md](PRIVACY.md)를 확인하세요.

## 라이선스

InfiniteDesk 자체 소스 코드, 디자인, 브랜드 자산, 문서는 오픈소스 라이선스로 배포되지 않습니다. 자세한 내용은 [NOTICE.md](NOTICE.md)를 확인하세요.

서드파티 오픈소스 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 확인하세요.
