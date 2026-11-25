(() => {
 const button=document.getElementById('pushToggle'), status=document.getElementById('pushStatus');
 if(!button || !status) return;
 const set = s => { status.textContent=s; };
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 let sdk=null, busy=false;
 button.addEventListener('click', async ()=>{
   if(ios&&!standalone()){set('아이폰은 홈 화면에 추가한 앱에서 알림을 켜 주세요.');return;}
   if(!sdk){set('알림 서비스 연결 준비 중입니다.');return;}
   if(busy)return; busy=true;button.disabled=true;
   try {
     if(sdk.User.PushSubscription.optedIn){await sdk.User.PushSubscription.optOut();set('뉴스 알림을 껐습니다.');}
     else if(Notification.permission==='denied'){set('휴대폰 설정에서 알림 권한을 허용해 주세요.');}
     else {if(!sdk.Notifications.permission)await sdk.Notifications.requestPermission();if(sdk.Notifications.permission)await sdk.User.PushSubscription.optIn();set(sdk.Notifications.permission?'알림 신청 완료':'알림 권한이 필요합니다.');}
   }catch(e){set('알림 설정 실패. 다시 시도해 주세요.');console.warn(e);}
   finally{busy=false;button.disabled=false;refresh();}
 });
 function refresh(){if(sdk)button.textContent=sdk.User.PushSubscription.optedIn?'🔔 알림 켜짐 · 끄기':'🔔 뉴스 알림 켜기';}
 fetch('./push-config.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('config');return r.json();}).then(cfg=>{
   if(!/^[0-9a-f-]{36}$/i.test(cfg.appId||'')){set('알림 서비스 연결 준비 중');return;}
   if(ios&&!standalone()){set('홈 화면 앱에서 알림 설정 가능');return;}
   window.OneSignalDeferred=window.OneSignalDeferred||[];
   window.OneSignalDeferred.push(async OneSignal=>{
     try{
       await OneSignal.init({appId:cfg.appId,serviceWorkerPath:'push/OneSignalSDKWorker.js',serviceWorkerParam:{scope:'/bismayah2026/push/'},notifyButton:{enable:false},welcomeNotification:{disable:true},autoResubscribe:false});
       if(!OneSignal.Notifications.isPushSupported()){set('이 브라우저에서는 알림을 지원하지 않습니다.');return;}
       sdk=OneSignal; refresh();set('');
       sdk.User.PushSubscription.addEventListener('change',refresh);
       sdk.Notifications.addEventListener('permissionChange',refresh);
     }catch(e){set('알림 서비스 초기화 실패');console.warn(e);}
   });
   const script=document.createElement('script');script.src='https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';script.async=true;script.onerror=()=>set('알림 서비스 연결 실패');document.head.append(script);
 }).catch(()=>set('알림 설정을 불러오지 못했습니다.'));
})();