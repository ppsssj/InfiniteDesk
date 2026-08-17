#include <windows.h>
#include <swdevice.h>

namespace
{
constexpr wchar_t HostMutexName[] = L"Local\\InfiniteDeskVirtualDisplayHost";
constexpr wchar_t HostStopEventName[] = L"Local\\InfiniteDeskVirtualDisplayHost.Stop";

struct CreationContext
{
    HANDLE eventHandle;
    HRESULT result;
};
}

VOID WINAPI
CreationCallback(
    _In_ HSWDEVICE hSwDevice,
    _In_ HRESULT hrCreateResult,
    _In_opt_ PVOID pContext,
    _In_opt_ PCWSTR pszDeviceInstanceId
    )
{
    auto* context = static_cast<CreationContext*>(pContext);
    context->result = hrCreateResult;
    SetEvent(context->eventHandle);
    UNREFERENCED_PARAMETER(hSwDevice);
    UNREFERENCED_PARAMETER(pszDeviceInstanceId);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previousInstance, PWSTR commandLine, int showCommand)
{
    UNREFERENCED_PARAMETER(instance);
    UNREFERENCED_PARAMETER(previousInstance);
    UNREFERENCED_PARAMETER(commandLine);
    UNREFERENCED_PARAMETER(showCommand);

    HANDLE instanceMutex = CreateMutexW(nullptr, TRUE, HostMutexName);
    if (instanceMutex == nullptr)
    {
        return 1;
    }
    if (GetLastError() == ERROR_ALREADY_EXISTS)
    {
        CloseHandle(instanceMutex);
        return 0;
    }

    HANDLE creationEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HANDLE stopEvent = CreateEventW(nullptr, TRUE, FALSE, HostStopEventName);
    if (creationEvent == nullptr || stopEvent == nullptr)
    {
        if (creationEvent != nullptr) CloseHandle(creationEvent);
        if (stopEvent != nullptr) CloseHandle(stopEvent);
        ReleaseMutex(instanceMutex);
        CloseHandle(instanceMutex);
        return 1;
    }

    CreationContext creationContext{ creationEvent, E_PENDING };
    HSWDEVICE hSwDevice = nullptr;
    SW_DEVICE_CREATE_INFO createInfo = { 0 };
    PCWSTR description = L"InfiniteDesk Virtual Display";

    // These match the Pnp id's in the inf file so OS will load the driver when the device is created    
    PCWSTR instanceId = L"InfiniteDeskVirtualDisplay";
    PCWSTR hardwareIds = L"InfiniteDeskVirtualDisplay\0\0";
    PCWSTR compatibleIds = L"InfiniteDeskVirtualDisplay\0\0";

    createInfo.cbSize = sizeof(createInfo);
    createInfo.pszzCompatibleIds = compatibleIds;
    createInfo.pszInstanceId = instanceId;
    createInfo.pszzHardwareIds = hardwareIds;
    createInfo.pszDeviceDescription = description;

    createInfo.CapabilityFlags = SWDeviceCapabilitiesRemovable |
                                 SWDeviceCapabilitiesSilentInstall |
                                 SWDeviceCapabilitiesDriverRequired;

    // Create the device
    HRESULT hr = SwDeviceCreate(L"InfiniteDeskVirtualDisplay",
                                L"HTREE\\ROOT\\0",
                                &createInfo,
                                0,
                                nullptr,
                                CreationCallback,
                                &creationContext,
                                &hSwDevice);
    if (FAILED(hr))
    {
        CloseHandle(stopEvent);
        CloseHandle(creationEvent);
        ReleaseMutex(instanceMutex);
        CloseHandle(instanceMutex);
        return 1;
    }

    DWORD waitResult = WaitForSingleObject(creationEvent, 10 * 1000);
    if (waitResult != WAIT_OBJECT_0 || FAILED(creationContext.result))
    {
        SwDeviceClose(hSwDevice);
        CloseHandle(stopEvent);
        CloseHandle(creationEvent);
        ReleaseMutex(instanceMutex);
        CloseHandle(instanceMutex);
        return 1;
    }

    // The software device remains available for the user session. A future
    // controller or maintenance tool can signal the named event for a clean
    // shutdown without requiring a visible console window.
    WaitForSingleObject(stopEvent, INFINITE);

    SwDeviceClose(hSwDevice);
    CloseHandle(stopEvent);
    CloseHandle(creationEvent);
    ReleaseMutex(instanceMutex);
    CloseHandle(instanceMutex);

    return 0;
}
