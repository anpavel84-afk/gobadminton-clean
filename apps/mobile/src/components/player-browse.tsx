import type { ComponentRef } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, BackHandler, findNodeHandle, Image, Modal, PanResponder, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import type { GestureResponderEvent, PanResponderCallbacks, PanResponderGestureState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePreventRemove, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BrowseSnapshot, MatchIdentity, PlayInterestCoordinator } from '../play-interest-coordinator.ts';
import type { PlayersSnapshot } from '../players.ts';
import type { City } from '../public-api.ts';
import { BrowseGesture, browseDragRotationDeg, browseExitDurationMs, browseExitTranslationPx, browseBioText, detailPages, measuredBioPages,
  ordinaryBrowsePlayers, PLAYER_BROWSE_RETURN_MS, tutorialStorageKey } from '../player-browse.ts';
import { useReduceMotion } from '../hooks.ts';
import { playerLevelLabel } from '../presentation.ts';
import { colors } from '../theme.ts';
import { DiscoveryIcon } from './discovery-icon.tsx';
import { PlayerAvatar } from './player-card.tsx';
import { SvgXml } from 'react-native-svg';
import { playerMediaUrl } from '../media.ts';
import { FriendlyMatch } from './friendly-match.tsx';
import { iosModalOrientations, Label, PrimaryButton, ScreenFrame, TextButton } from './ui.tsx';
import { bindIosBack } from '../ios-back.ts';

const useIosBack = bindIosBack(Platform.OS, usePreventRemove);
function BrowseIosBack({open,onBack}:{open:boolean;onBack:()=>void}) {
  useIosBack(open,onBack);
  return null;
}

// Exact existing canonical/ce252.svg fallback, shared visually with PlayerProfile.
const defaultCoverXml = "<svg preserveAspectRatio=\"none\" overflow=\"visible\" style=\"display: block;\" width=\"200\" height=\"200\" viewBox=\"0 0 200 200\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g id=\"&#208;&#164;&#208;&#184;&#208;&#179;&#209;&#131;&#209;&#128;&#208;&#176; 3\">\n<circle id=\"Ellipse 63\" cx=\"25\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 64\" cx=\"75\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 65\" cx=\"125\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 66\" cx=\"175\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 67\" cx=\"25\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 68\" cx=\"75\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 69\" cx=\"125\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 70\" cx=\"175\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 71\" cx=\"25\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 72\" cx=\"75\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 73\" cx=\"125\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 74\" cx=\"175\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 75\" cx=\"25\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 76\" cx=\"75\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 77\" cx=\"125\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 78\" cx=\"175\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n</g>\n</svg>\n";

type Props = {owner:PlayInterestCoordinator;state:BrowseSnapshot;self:MatchIdentity|null;focused:boolean;placeLabel:string;cities?:readonly City[];
  status:'idle'|'loading'|'ready'|'error';loadingMore:boolean;moreError:boolean;
  onRetry:()=>void;onMore:()=>void;onClose:()=>void;onLogin:()=>void;onProfileRetry:()=>void;
  onDetail:(id:string)=>void;detail:PlayersSnapshot['detail']};

/** Native touch and explicit controls share the same captured card/episode and root command owner. */
export function PlayerBrowse({owner,state,self,focused,placeLabel,cities=[],status,loadingMore,moreError,onRetry,onMore,onClose,onLogin,onProfileRetry,onDetail,detail}:Props) {
  const router = useRouter(), reduced = useReduceMotion(), insets = useSafeAreaInsets();
  const viewport=useWindowDimensions();
  const [failedCover,setFailedCover]=useState<string|null>(null);
  const players = ordinaryBrowsePlayers(state.page?.items ?? [], self?.publicPlayerId);
  const [skipped,setSkipped] = useState<string[]>([]), [exhausted,setExhausted] = useState(false);
  const selected = players.find(p=>p.publicPlayerId===state.selected) ?? players[0];
  const peer = exhausted ? undefined : selected;
  const [info,setInfo] = useState<number|null>(null), [tutorial,setTutorial] = useState<0|1|2>(0);
  const [tutorialReady,setTutorialReady] = useState<string|null>(null);
  const [size,setSize] = useState({width:0,height:0});
  const [pose] = useState(()=>new Animated.ValueXY());
  const gesture = useRef<BrowseGesture|null>(null), flying = useRef(false), closeFocus = useRef<ComponentRef<typeof View>>(null);
  const live = useRef({peer:peer?.publicPlayerId,episode:state.episode,focused});
  live.current={peer:peer?.publicPlayerId,episode:state.episode,focused};
  const actorKey = tutorialStorageKey(state.actor?.actorId ?? null);
  const card = peer?.publicPlayerId, episode = state.episode;
  const current = () => focused && live.current.focused && live.current.peer===card && live.current.episode===episode &&
    owner.getSnapshot().active && owner.getSnapshot().foreground && owner.getSnapshot().episode===episode && owner.getSnapshot().selected===card;
  const blocked = !focused || !state.foreground || !!state.match || tutorialReady!==actorKey || tutorial!==0;
  const view = card ? state.states.get(card) : undefined;
  const expanded = card && detail.id===card && detail.status==='ready' ? detail.data : null;
  const display = expanded ?? peer;
  const cover=playerMediaUrl(display?.cover?.uploadedUrl,'cover');
  const [bodySize,setBodySize]=useState({width:0,height:0});
  const [bioMeasure,setBioMeasure]=useState<{key:string;lines:{text:string;height:number}[]}|null>(null);
  const [intent,setIntent]=useState<'skip'|'request'|null>(null);
  const detailOverflow=useRef(false);
  const [detailContentHeight,setDetailContentHeight]=useState(0);
  detailOverflow.current=detailContentHeight>bodySize.height+1;
  const bio=display ? browseBioText(display) : '';
  const measureKey=JSON.stringify([card,bio,bodySize.width,viewport.fontScale]);
  const cityName = cities.find(c=>c.id===display?.cityId)?.nameRu;
  const pages = display ? detailPages(display,bioMeasure?.key===measureKey ? measuredBioPages(bio,bioMeasure.lines,bodySize.height-4) : undefined) : [];
  const infoLast = pages.length; // facts → bio pages → public games availability / profile
  useLayoutEffect(() => {
    gesture.current?.cancel(); flying.current=false;pose.stopAnimation();pose.setValue({x:0,y:0});setInfo(null);setIntent(null);
    if(card) AccessibilityInfo.announceForAccessibility(`Игрок: ${peer!.displayName}`);
    return () => {gesture.current?.cancel();pose.stopAnimation();};
  }, [card,episode,pose]);
  useEffect(() => {
    let active=true;setTutorialReady(null);setTutorial(0);
    void AsyncStorage.getItem(actorKey).then(value=>{if(active){setTutorial(value==='complete'?0:1);setTutorialReady(actorKey);}})
      .catch(()=>{if(active){setTutorial(1);setTutorialReady(actorKey);}});
    return ()=>{active=false;};
  }, [actorKey]);
  useEffect(() => {
    if (!focused) return;
    const back=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(owner.getSnapshot().match)owner.dismiss();
      else if(tutorial!==0)setTutorial(0);
      else if(info!==null)setInfo(null);
      else onClose();
      return true;
    });
    return ()=>back.remove();
  }, [focused,owner,tutorial,info,onClose]);
  useEffect(() => {
    setSkipped([]);setExhausted(false);
  }, [state.filters,state.actor?.actorId,state.actor?.sessionId,state.actor?.generation]);
  useEffect(() => {
    if(!focused)return;
    const handle=findNodeHandle(closeFocus.current);if(handle)AccessibilityInfo.setAccessibilityFocus(handle);
  }, [focused]);
  useEffect(() => {
    if(tutorialReady===actorKey && tutorial)AccessibilityInfo.announceForAccessibility(tutorial===1?'Свайп влево — пропустить':'Свайп вправо — давай сыграем');
  }, [tutorialReady,actorKey,tutorial]);
  useEffect(() => {
    if(players[0] && !players.some(p=>p.publicPlayerId===state.selected))owner.select(players[0].publicPlayerId);
  }, [owner,state.selected,self?.publicPlayerId,players[0]?.publicPlayerId]);
  useEffect(() => {
    if(focused && state.actor && state.foreground && card && !state.command && !state.match)void owner.refresh([card]);
  }, [owner,focused,state.actor,state.foreground,card,episode,state.command?.status,!!state.match]);
  const finishTutorial = () => {
    if(tutorialReady!==actorKey)return;
    if(tutorial===1){setTutorial(2);return;}
    if(tutorial===2){setTutorial(0);void AsyncStorage.setItem(actorKey,'complete').catch(()=>{});}
  };
  const openInfo = () => {if(!current())return;setInfo(0);if(card)onDetail(card);};
  const vertical = (up:boolean) => {
    if(up){if(info===null)openInfo();else setInfo(Math.min(infoLast,info+1));}
    else if(info!==null){if(info===0)setInfo(null);else setInfo(info-1);}
  };
  const advance = () => {
    if(!current() || !card)return;
    setSkipped(stack=>[...stack.filter(id=>id!==card),card]);
    const index=players.findIndex(p=>p.publicPlayerId===card);
    const next=players.slice(index+1).find(p=>!skipped.includes(p.publicPlayerId));
    if(next){owner.select(next.publicPlayerId,episode);setExhausted(false);}
    else {setExhausted(true);if(state.page?.nextCursor && !loadingMore)onMore();}
  };
  useEffect(() => {
    if(!exhausted)return;
    const next=players.find(p=>!skipped.includes(p.publicPlayerId));
    if(next){owner.select(next.publicPlayerId,episode);setExhausted(false);}
  }, [exhausted,state.page,skipped,owner,episode]);
  const exit = (dir:-1|1,velocity=0,dx=0) => {
    if(!current() || flying.current)return;
    flying.current=true;
    const x=browseExitTranslationPx({dir,width:size.width,height:size.height,rotationDeg:browseDragRotationDeg(dx,size.width,reduced),currentX:dx});
    Animated.timing(pose,{toValue:{x:reduced?0:x,y:0},duration:reduced?0:browseExitDurationMs(x-dx,velocity),useNativeDriver:true}).start(({finished})=>{
      if(finished && current())advance();
      flying.current=false;
      if(current())pose.setValue({x:0,y:0});
    });
  };
  const action = (kind:'skip'|'request'|'withdraw',velocity=0,dx=0) => {
    if(!current() || blocked || flying.current || !card)return;
    if(kind==='request' || kind==='withdraw'){
      if(!state.actor){onLogin();return;}
      if(!self){onProfileRetry();return;}
      if(state.command || state.reading || !(kind==='request'?view?.capabilities.canSend:view?.capabilities.canWithdraw))return;
      // act synchronously reserves the immutable packet before any token/network await.
      void owner.act(kind==='request'?'send':'withdraw',card,episode,self).then(receipt=>{
        if(receipt?.outcome==='outgoing' && current())exit(1);
      });
      return;
    }
    exit(-1,velocity,dx);
  };
  const callbacks:PanResponderCallbacks = {
    onStartShouldSetPanResponder:(event:GestureResponderEvent)=>{
      if(!blocked && !flying.current && current()){
        gesture.current=new BrowseGesture(card!,episode,event.nativeEvent.timestamp);
        pose.stopAnimation();pose.setValue({x:0,y:0});
      }
      return false;
    },
    onMoveShouldSetPanResponder:(event:GestureResponderEvent,g:PanResponderGestureState)=>{
      if(blocked || flying.current || !current() || size.width<=0 || size.height<=0)return false;
      if(Math.max(Math.abs(g.dx),Math.abs(g.dy))<8)return false;
      const touch=gesture.current;if(!touch)return false;
      touch.move(g.dx,g.dy,event.nativeEvent.timestamp);
      if(info!==null && touch.axis==='vertical' && detailOverflow.current)return false;
      return touch.axis!=='none';
    },
    onPanResponderMove:(event:GestureResponderEvent,g:PanResponderGestureState)=>{
      const touch=gesture.current;if(!touch || !current())return;
      touch.move(g.dx,g.dy,event.nativeEvent.timestamp);
      setIntent(touch.axis==='horizontal' ? (g.dx<0?'skip':'request') : null);
      pose.setValue({x:touch.axis==='horizontal'&&!reduced?g.dx:0,y:touch.axis==='vertical'&&!reduced?(info===null?Math.min(0,g.dy):Math.max(0,g.dy)):0});
    },
    onPanResponderRelease:(event:GestureResponderEvent,g:PanResponderGestureState)=>{
      const touch=gesture.current;gesture.current=null;setIntent(null);
      if(!touch || touch.peer!==card || touch.episode!==episode || !current())return;
      const {result,velocity}=touch.release(g.dx,g.dy,event.nativeEvent.timestamp,size.width,size.height);
      if(result==='skip')action('skip',velocity,g.dx);
      else {
        Animated.timing(pose,{toValue:{x:0,y:0},duration:reduced?0:PLAYER_BROWSE_RETURN_MS,useNativeDriver:true}).start();
        if(result==='request')action('request');
        else if(result==='vertical-up')vertical(true);
        else if(result==='vertical-down')vertical(false);
      }
    },
    onPanResponderTerminate:()=>{setIntent(null);gesture.current?.cancel();gesture.current=null;pose.setValue({x:0,y:0});},
    onPanResponderTerminationRequest:()=>true,
  };
  // Keep RN's recognizer instance through reads/renders during a touch. Each callback
  // still verifies the touch's captured peer/episode before reaching the root owner.
  const responder = useRef(callbacks);responder.current=callbacks;
  const [handlers] = useState(()=>PanResponder.create({
    onStartShouldSetPanResponder:(e,g)=>responder.current.onStartShouldSetPanResponder?.(e,g) ?? false,
    onMoveShouldSetPanResponder:(e,g)=>responder.current.onMoveShouldSetPanResponder?.(e,g) ?? false,
    onPanResponderMove:(e,g)=>responder.current.onPanResponderMove?.(e,g),
    onPanResponderRelease:(e,g)=>responder.current.onPanResponderRelease?.(e,g),
    onPanResponderTerminate:(e,g)=>responder.current.onPanResponderTerminate?.(e,g),
    onPanResponderTerminationRequest:(e,g)=>responder.current.onPanResponderTerminationRequest?.(e,g) ?? true,
  }));
  useEffect(()=>{setInfo(page=>page===null ? null : Math.min(page,infoLast));},[infoLast]);
  const reopenTutorial = () => {if(tutorialReady===actorKey)setTutorial(1);};
  const undo = () => {
    if(blocked || flying.current)return;
    const id=skipped[skipped.length-1];
    if(id && players.some(p=>p.publicPlayerId===id)){setSkipped(skipped.slice(0,-1));setExhausted(false);owner.select(id,episode);}
  };
  const match = state.active && focused && state.foreground ? state.match : null;
  return <ScreenFrame>
    <View style={{flex:1,backgroundColor:colors.ink,paddingBottom:insets.bottom}}>
      {peer ? <>
        <Animated.View key={card} {...handlers.panHandlers} style={{flex:1,minHeight:0,backgroundColor:colors.ink,overflow:'hidden',
          transform:reduced?[]:[...pose.getTranslateTransform(),{rotate:pose.x.interpolate({inputRange:[-Math.max(1,size.width),0,Math.max(1,size.width)],outputRange:['-12deg','0deg','12deg'],extrapolate:'clamp'})}]}}
          onLayout={event=>setSize({width:event.nativeEvent.layout.width,height:event.nativeEvent.layout.height})}>
          {info===null ? <View style={{flex:1,minHeight:0}}>
            <View style={{flex:1,minHeight:0,alignItems:'center',justifyContent:'flex-end',paddingBottom:16,overflow:'hidden'}}>
              {cover && cover!==failedCover ? <Image accessible={false} source={{uri:cover}} resizeMode="cover"
                style={{position:'absolute',width:'100%',height:'100%'}} onError={()=>setFailedCover(cover)} />
                : <SvgXml xml={defaultCoverXml} width="100%" height="100%" style={{position:'absolute'}} accessible={false} />}
              <PlayerAvatar key={`${card}:${display!.avatar?.uploadedUrl}:${display!.avatar?.providerUrl}`} player={display!} large />
            </View>
            <ScrollView style={{flexGrow:0,maxHeight:'60%'}} contentContainerStyle={{padding:16,gap:6}}>
              {(display!.lookingForGame || display!.trainer) && <Label style={{color:colors.lime}}>{display!.lookingForGame?'Ищу игру':'Тренер'}</Label>}
              <Label accessibilityRole="header" style={{fontSize:26,lineHeight:32,fontWeight:'700',color:colors.card}}>{display!.displayName}</Label>
              <Label style={{color:colors.card}}>{[playerLevelLabel(display!.level),cityName,display!.areaKey].filter(Boolean).join(' · ')}</Label>
              <Label style={{color:colors.card,fontSize:12}}>Уровень — со слов игрока</Label>
            </ScrollView>
          </View> : <View style={{flex:1,minHeight:0,paddingHorizontal:16,paddingTop:64,gap:8,backgroundColor:'#162820'}}>
            <Label accessibilityRole="header" style={{color:colors.card,fontWeight:'700'}}>{info===0?'Игровой профиль':info===infoLast?'Ближайшие игры':'О себе'}</Label>
            <View style={{flex:1,minHeight:0}} onLayout={event=>setBodySize({width:event.nativeEvent.layout.width,height:event.nativeEvent.layout.height})}>
              <ScrollView key={`${card}:${info}`} style={{flex:1}} contentContainerStyle={{gap:12,paddingBottom:4}}
                scrollEnabled={detailOverflow.current} onContentSizeChange={(_w,h)=>setDetailContentHeight(h)}>
                {info===0 && <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
                  <PlayerAvatar key={card} player={display!} /><Label accessibilityRole="header" style={{flex:1,fontSize:20,lineHeight:26,color:colors.card,fontWeight:'700'}}>{display!.displayName}</Label>
                </View>}
                {info===0 ? <>
                  <Label style={{color:colors.card}}>{playerLevelLabel(display!.level)} · Самооценка игрока</Label>
                  <Label style={{color:colors.card}}>Город: {cityName || 'Не указан'}</Label>
                  <Label style={{color:colors.card}}>Район / метро: {display!.areaKey || 'Не указан'}</Label>
                  <Label style={{color:colors.card}}>{display!.trainer?'Тренер':display!.lookingForGame?'Ищу игру':'Игрок'}</Label>
                </> : info===infoLast ? <>
                  <Label style={{color:colors.card}}>Публичные ближайшие игры этого игрока пока недоступны.</Label>
                  <TextButton light title="Открыть профиль игрока" onPress={()=>{if(!blocked && current())router.push(`/players/${card}`);}} />
                </> : <Label style={{color:colors.card}}>{pages[info]}</Label>}
              </ScrollView>
              {/* Native line measurement uses the same width/font as the visible bio. No fixed character limit. */}
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                style={{position:'absolute',top:0,left:0,right:0,opacity:0}}>
                <Label onTextLayout={event=>{
                  const lines=event.nativeEvent.lines.map(({text,height})=>({text,height}));
                  setBioMeasure(old=>old?.key===measureKey && JSON.stringify(old.lines)===JSON.stringify(lines) ? old : {key:measureKey,lines});
                }}>{bio || 'О себе пока ничего не написано.'}</Label>
              </View>
            </View>
            <Label accessibilityLiveRegion="polite" style={{color:colors.card,fontSize:12}}>Страница {info+1} / {infoLast+1}</Label>
          </View>}
          {intent && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={{position:'absolute',top:'35%',alignSelf:'center',padding:18,borderRadius:20,borderWidth:2,borderColor:intent==='skip'?colors.card:colors.lime,backgroundColor:intent==='skip'?'#13221ADD':'#EAFFCDF0'}}>
            <Label style={{fontSize:24,lineHeight:32,fontWeight:'700',color:intent==='skip'?colors.card:colors.ink}}>{intent==='skip'?'← Пропустить':'Давай сыграем →'}</Label>
          </View>}
        </Animated.View>
        {/* Fixed pager and action slots reserve their actual height before the cover grows. */}
        <ScrollView style={{flexGrow:0,maxHeight:'45%',backgroundColor:'#0f1c15'}} contentContainerStyle={{paddingHorizontal:12,paddingVertical:8,gap:8}}>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}}>
            <View style={{flex:1}}><TextButton light title={info===null?'Подробнее об игроке':info===0?'К обложке':'Назад'} onPress={()=>{if(blocked || !current())return;if(info===null)openInfo();else vertical(false);}} /></View>
            {info!==null && info<infoLast && <View style={{flex:1}}><TextButton light title="Ещё сведения" onPress={()=>{if(!blocked && current())vertical(true);}} /></View>}
          </View>
          <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
            <Pressable accessibilityRole="button" accessibilityLabel="Вернуть пропущенного игрока" accessibilityState={{disabled:!skipped.length || blocked}}
              disabled={!skipped.length || blocked} onPress={undo} style={{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center',opacity:skipped.length?1:.45}}>
              <Label style={{color:colors.card,fontSize:24}}>↶</Label>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Пропустить игрока" accessibilityState={{disabled:blocked}} disabled={blocked} onPress={()=>action('skip')}
              style={{flex:1,minHeight:48,alignItems:'center',justifyContent:'center',paddingHorizontal:6}}><Label style={{color:colors.card,textAlign:'center'}}>Пропустить</Label></Pressable>
            <View style={{flex:1.35}}><PrimaryButton title={!state.actor?'Войти, чтобы сыграть':state.command?.status==='unknown'?'Результат неизвестен':state.command?'Отправляем…':view?.relationship==='mutual'?'Вы оба хотите сыграть':view?.relationship==='outgoing'?'Предложение отправлено':'Давай сыграем'}
              disabled={blocked || !!state.command || !!state.actor && (state.reading || !view?.capabilities.canSend)} onPress={()=>action('request')} /></View>
          </View>
          {info!==null && detail.id===card && detail.status==='loading' && <Label style={{color:colors.card}}>Загружаем подробности…</Label>}
          {info!==null && detail.id===card && detail.status==='error' && <TextButton light title="Повторить загрузку профиля" onPress={()=>onDetail(card!)} />}
          {view?.capabilities.canWithdraw && <TextButton light title="Отозвать предложение" onPress={()=>action('withdraw')} />}
          {!view && state.actor && !state.reading && <TextButton light title="Проверить доступность предложения" onPress={()=>{if(card)void owner.refresh([card]);}} />}
          {view?.relationship==='unavailable' && <Label style={{color:colors.card}}>Предложение сейчас недоступно.</Label>}
          {state.actor && !self && <TextButton light title="Проверить свой игровой профиль" onPress={onProfileRetry} />}
          {status==='error' && <TextButton light title="Повторить загрузку каталога" onPress={onRetry} />}
          {state.notice && <Label accessibilityLiveRegion="polite" style={{color:colors.card}}>{state.notice}</Label>}
          {state.command?.status==='unknown' && <PrimaryButton title="Проверить результат исходного запроса" onPress={()=>{void owner.reconcile();}} />}
        </ScrollView>
      </> : <ScrollView contentContainerStyle={{flexGrow:1,justifyContent:'center',padding:24,paddingTop:72,gap:16}}>
        <Label style={{color:colors.card}}>{[placeLabel,state.filters.name,state.filters.areaKey,state.filters.looking?'Ищу игру':'',state.filters.trainer?'Тренер':''].filter(Boolean).join(' · ')}</Label>
        {status==='loading' && <Label style={{color:colors.card}} accessibilityLiveRegion="polite">Загружаем игроков…</Label>}
        {status==='error' && <><Label style={{color:colors.card}}>Не удалось загрузить каталог игроков.</Label><PrimaryButton title="Повторить" onPress={onRetry} /></>}
        {status==='ready' && <><Label accessibilityRole="header" style={{color:colors.card}}>{skipped.length?'Все загруженные игроки просмотрены':'Игроки не найдены'}</Label>
          <Label style={{color:colors.card}}>По выбранным фильтрам пока нет других доступных игроков.</Label><TextButton light title="Обновить каталог" onPress={()=>{setSkipped([]);setExhausted(false);onRetry();}} /></>}
        {skipped.length>0 && <TextButton light title="Вернуть пропущенного игрока" onPress={undo} />}
        {state.notice && <Label accessibilityLiveRegion="polite" style={{color:colors.card}}>{state.notice}</Label>}
        {state.command?.status==='unknown' && <PrimaryButton title="Проверить результат исходного запроса" onPress={()=>{void owner.reconcile();}} />}
      </ScrollView>}
      {(state.page?.nextCursor || moreError) && (!peer || moreError) && <PrimaryButton title={loadingMore?'Загружаем…':moreError?'Повторить загрузку следующих игроков':'Показать ещё игроков'} disabled={loadingMore} onPress={onMore} />}
      <View pointerEvents="box-none" style={{position:'absolute',top:8,left:12,right:12,flexDirection:'row',justifyContent:'space-between'}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Как пользоваться свайпом" onPress={reopenTutorial}
          style={{minWidth:48,minHeight:48,borderRadius:24,backgroundColor:colors.card,alignItems:'center',justifyContent:'center'}}><Label style={{fontWeight:'700',fontSize:22}}>?</Label></Pressable>
        <Pressable ref={closeFocus} accessibilityRole="button" accessibilityLabel="Закрыть свайп и вернуться к игрокам" onPress={onClose}
          style={{minWidth:48,minHeight:48,borderRadius:24,backgroundColor:colors.card,alignItems:'center',justifyContent:'center'}}><DiscoveryIcon name="close" /></Pressable>
      </View>
    </View>
    <Modal transparent visible={focused && tutorialReady===actorKey && tutorial!==0 && !!peer && !match} animationType="none" supportedOrientations={iosModalOrientations} onRequestClose={()=>setTutorial(0)}>
      <View style={{flex:1,backgroundColor:'#13221AEF',justifyContent:'center',paddingTop:insets.top+16,paddingBottom:insets.bottom+16,paddingLeft:insets.left+24,paddingRight:insets.right+24}}>
        <ScrollView contentContainerStyle={{flexGrow:1,justifyContent:'center',gap:20}}>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть подсказку" onPress={()=>setTutorial(0)} style={{minWidth:48,minHeight:48,alignSelf:'flex-end',justifyContent:'center',alignItems:'center'}}><DiscoveryIcon name="close" color={colors.card} /></Pressable>
          <Label accessibilityRole="header" style={{color:tutorial===1?colors.card:colors.lime,fontSize:28,lineHeight:36,fontWeight:'700',textAlign:'center'}}>{tutorial===1?'← Свайп влево — пропустить':'Свайп вправо — давай сыграем →'}</Label>
          <Label style={{color:colors.card,textAlign:'center'}}>{tutorial===1?'Игрок не получит уведомления. Те же действия доступны кнопками.':'Совпадение появляется только когда оба хотите сыграть. Свайп вверх откроет подробности, вниз вернёт обложку.'}</Label>
          <PrimaryButton title={tutorial===1?'Далее':'Начать поиск'} onPress={finishTutorial} />
        </ScrollView>
      </View>
    </Modal>
    {match && <FriendlyMatch match={match} onDismiss={owner.dismiss} current={()=>owner.getSnapshot().match===match && owner.getSnapshot().active && owner.getSnapshot().foreground} />}
    <BrowseIosBack open={focused && (!!state.match || tutorial!==0 || info!==null)} onBack={()=>{
      if(owner.getSnapshot().match)owner.dismiss();
      else if(tutorial!==0)setTutorial(0);
      else if(info!==null)setInfo(null);
    }} />
  </ScreenFrame>;
}
