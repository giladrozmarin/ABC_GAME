import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Dimensions,
  PanResponder,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Path, Circle } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

const letterPaths = {
  A: 'M 50 180 L 100 60 L 150 180 M 75 130 L 125 130',
  B: 'M 60 60 L 60 180 L 120 180 Q 140 180 140 160 Q 140 140 120 140 L 60 140 M 60 140 L 120 140 Q 140 140 140 120 Q 140 100 120 100 L 60 100 L 60 60 L 120 60 Q 140 60 140 80 Q 140 100 120 100',
  C: 'M 140 100 Q 140 60 100 60 Q 60 60 60 100 L 60 140 Q 60 180 100 180 Q 140 180 140 140',
  D: 'M 60 60 L 60 180 L 120 180 Q 160 180 160 120 Q 160 60 120 60 Z',
  E: 'M 60 60 L 60 180 L 140 180 M 60 120 L 120 120 M 60 60 L 140 60',
  F: 'M 60 60 L 60 180 M 60 120 L 120 120 M 60 60 L 140 60',
  G: 'M 140 100 Q 140 60 100 60 Q 60 60 60 100 L 60 140 Q 60 180 100 180 Q 140 180 140 140 L 140 120 L 120 120',
  H: 'M 60 60 L 60 180 M 140 60 L 140 180 M 60 120 L 140 120',
  I: 'M 80 60 L 120 60 M 100 60 L 100 180 M 80 180 L 120 180',
  J: 'M 80 60 L 140 60 M 120 60 L 120 160 Q 120 180 100 180 Q 80 180 80 160',
};

const letters = Object.keys(letterPaths);

export default function LetterTracing({ onBack }) {
  const [currentLetterIndex, setCurrentLetterIndex] = useState(0);
  const [userPath, setUserPath] = useState('');
  const [isTracing, setIsTracing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [animatedValue] = useState(new Animated.Value(0));
  
  const currentLetter = letters[currentLetterIndex];
  const currentPath = letterPaths[currentLetter];

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setIsTracing(true);
        const { locationX, locationY } = evt.nativeEvent;
        setUserPath(`M ${locationX} ${locationY}`);
      },
      onPanResponderMove: (evt) => {
        if (isTracing) {
          const { locationX, locationY } = evt.nativeEvent;
          setUserPath(prevPath => `${prevPath} L ${locationX} ${locationY}`);
        }
      },
      onPanResponderRelease: () => {
        setIsTracing(false);
        checkTracing();
      },
    })
  ).current;

  const checkTracing = () => {
    // Simple success check - you could make this more sophisticated
    if (userPath.length > 50) {
      setShowSuccess(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShowSuccess(false);
      });
    }
  };

  const handleNextLetter = () => {
    setCurrentLetterIndex((prev) => (prev + 1) % letters.length);
    setUserPath('');
    setShowSuccess(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handlePreviousLetter = () => {
    setCurrentLetterIndex((prev) => (prev - 1 + letters.length) % letters.length);
    setUserPath('');
    setShowSuccess(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const clearTracing = () => {
    setUserPath('');
    setShowSuccess(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#f093fb', '#f5576c']}
        style={styles.background}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Trace the Letter!</Text>
        </View>

        <View style={styles.letterDisplay}>
          <Text style={styles.currentLetter}>{currentLetter}</Text>
        </View>

        <View style={styles.tracingArea} {...panResponder.panHandlers}>
          <Svg width={width - 40} height={300} style={styles.svg}>
            {/* Letter outline */}
            <Path
              d={currentPath}
              stroke="rgba(255, 255, 255, 0.3)"
              strokeWidth="8"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            
            {/* User's tracing */}
            <Path
              d={userPath}
              stroke="#FFD700"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            
            {/* Starting point indicator */}
            <Circle
              cx="50"
              cy="60"
              r="8"
              fill="#32CD32"
              opacity={userPath ? 0.3 : 1}
            />
          </Svg>
          
          {showSuccess && (
            <Animated.View
              style={[
                styles.successOverlay,
                {
                  opacity: animatedValue,
                  transform: [
                    {
                      scale: animatedValue.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.5, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text style={styles.successText}>🌟 Great Job! 🌟</Text>
            </Animated.View>
          )}
        </View>

        <View style={styles.instructions}>
          <Text style={styles.instructionText}>
            Start at the green dot and trace the letter with your finger
          </Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.controlButton} onPress={handlePreviousLetter}>
            <Text style={styles.controlButtonText}>← Previous</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.clearButton} onPress={clearTracing}>
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.controlButton} onPress={handleNextLetter}>
            <Text style={styles.controlButtonText}>Next →</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.progress}>
          <Text style={styles.progressText}>
            Letter {currentLetterIndex + 1} of {letters.length}
          </Text>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  backButton: {
    padding: 10,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginRight: 50,
  },
  letterDisplay: {
    alignItems: 'center',
    marginBottom: 20,
  },
  currentLetter: {
    fontSize: 80,
    fontWeight: 'bold',
    color: 'white',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  tracingArea: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 10,
    marginBottom: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  svg: {
    backgroundColor: 'transparent',
  },
  successOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 255, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  successText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  instructions: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  instructionText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  controlButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  controlButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  clearButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 25,
  },
  clearButtonText: {
    color: '#f5576c',
    fontSize: 16,
    fontWeight: 'bold',
  },
  progress: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  progressText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
  },
}); 