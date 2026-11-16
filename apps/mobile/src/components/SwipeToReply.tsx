import { useEffect, useState, type ReactNode } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { colors } from '../styles';
import { haptic } from '../feedback';
import { isReplySwipe, swipeReplyOffset, swipeReplyTriggered, SWIPE_REPLY_TRIGGER } from '../swipe-reply-model';
import { Icon } from './ui';

/** Gesture state that must never re-render the bubble lives here, outside React state. */
class SwipeController {
  readonly offset = new Animated.Value(0);
  readonly arrowOpacity = this.offset.interpolate({ inputRange: [-SWIPE_REPLY_TRIGGER, -12, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' });
  private armed = false;
  private enabled = true;
  private reply: () => void = () => {};
  readonly responder = PanResponder.create({
    // Capture phase: a horizontal drag must win over the bubble's own Pressable.
    onMoveShouldSetPanResponderCapture: (_, gesture) => this.enabled && isReplySwipe(gesture.dx, gesture.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, gesture) => {
      this.offset.setValue(swipeReplyOffset(gesture.dx));
      const past = swipeReplyTriggered(gesture.dx);
      if (past !== this.armed) { this.armed = past; if (past) haptic('tick'); }
    },
    onPanResponderRelease: (_, gesture) => {
      if (swipeReplyTriggered(gesture.dx)) this.reply();
      this.reset(6);
    },
    onPanResponderTerminate: () => this.reset(0),
  });
  update(enabled: boolean, reply: () => void) { this.enabled = enabled; this.reply = reply; }
  private reset(bounciness: number) {
    this.armed = false;
    Animated.spring(this.offset, { toValue: 0, useNativeDriver: true, bounciness }).start();
  }
}

/**
 * Telegram-style: drag a message to the left and release to reply. The reply arrow fades in
 * behind the bubble and a haptic tick marks the point where releasing will reply. Vertical
 * scrolling, taps and long presses pass through untouched.
 */
export function SwipeToReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: ReactNode }) {
  const [swipe] = useState(() => new SwipeController());
  useEffect(() => { swipe.update(enabled, onReply); }, [swipe, enabled, onReply]);
  return <View {...swipe.responder.panHandlers}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', right: 6, top: 0, bottom: 0, justifyContent: 'center', opacity: swipe.arrowOpacity }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(43, 74, 62, 0.18)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="arrow-undo" size={18} color={colors.accent} />
      </View>
    </Animated.View>
    <Animated.View style={{ transform: [{ translateX: swipe.offset }] }}>{children}</Animated.View>
  </View>;
}
