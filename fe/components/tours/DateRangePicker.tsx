import React, { useState } from 'react';
import {
  Box,
  Pressable,
  Text,
  VStack,
  HStack,
  Button,
  ButtonText,
  Icon,
  ScrollView,
} from '@gluestack-ui/themed';
import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
} from '@gluestack-ui/themed';
import { Calendar, ChevronLeft, ChevronRight, Check } from 'lucide-react-native';
import { parseLocalDate } from '@/utils/date';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  days: number;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onDaysChange: (days: number) => void;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  days,
  onStartDateChange,
  onEndDateChange,
  onDaysChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tempStartDate, setTempStartDate] = useState(startDate);
  const [tempEndDate, setTempEndDate] = useState(endDate);
  const [currentMonth, setCurrentMonth] = useState(
    startDate ? parseLocalDate(startDate) : new Date()
  );
  const [selectionMode, setSelectionMode] = useState<'start' | 'end'>('start');

  const formatDateLabel = (dateString: string): string => {
    if (!dateString) return '';
    const date = parseLocalDate(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
    });
  };

  const formatDateRange = (): string => {
    if (!startDate && !endDate) return '';
    const start = startDate ? parseLocalDate(startDate) : null;
    const end = endDate ? parseLocalDate(endDate) : null;

    if (start && end) {
      const daysDiff =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
      const startStr = formatDateLabel(startDate);
      const endStr = formatDateLabel(endDate);
      return `${startStr} – ${endStr} (${daysDiff} ${daysDiff === 1 ? 'Día' : 'Días'})`;
    } else if (start) {
      const startStr = formatDateLabel(startDate);
      return `${startStr} (1 Día)`;
    }
    return '';
  };

  const handleOpen = () => {
    setTempStartDate(startDate);
    setTempEndDate(endDate);
    setCurrentMonth(
      startDate
        ? parseLocalDate(startDate)
        : endDate
          ? parseLocalDate(endDate)
          : new Date()
    );
    setSelectionMode('start');
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleClear = () => {
    setTempStartDate('');
    setTempEndDate('');
    setSelectionMode('start');
  };

  const handlePreset = (numDays: number) => {
    const today = new Date();
    const startStr = formatLocalDate(today);
    const end = new Date(today);
    end.setDate(today.getDate() + (numDays - 1));
    const endStr = formatLocalDate(end);

    setTempStartDate(startStr);
    setTempEndDate(endStr);
    onStartDateChange(startStr);
    onEndDateChange(endStr);
    onDaysChange(numDays);
    setIsOpen(false);
  };

  const handleConfirm = () => {
    if (tempStartDate) onStartDateChange(tempStartDate);
    if (tempEndDate) onEndDateChange(tempEndDate);
    if (tempStartDate && tempEndDate) {
      const start = parseLocalDate(tempStartDate);
      const end = parseLocalDate(tempEndDate);
      const daysDiff =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
      onDaysChange(daysDiff);
    } else if (tempStartDate) {
      onEndDateChange(tempStartDate);
      onDaysChange(1);
    }
    setIsOpen(false);
  };

  const handleDateSelect = (date: Date) => {
    const dateStr = formatLocalDate(date);

    if (selectionMode === 'start') {
      setTempStartDate(dateStr);
      if (tempEndDate && parseLocalDate(dateStr) > parseLocalDate(tempEndDate)) {
        setTempEndDate('');
      }
      setSelectionMode('end');
    } else {
      if (tempStartDate && parseLocalDate(dateStr) < parseLocalDate(tempStartDate)) {
        setTempStartDate(dateStr);
        setTempEndDate('');
        setSelectionMode('end');
      } else {
        setTempEndDate(dateStr);
      }
    }
  };

  const getDaysInMonth = (date: Date): number => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date): number => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentMonth);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentMonth(newDate);
  };

  const isDateSelected = (dateStr: string): boolean => {
    return dateStr === tempStartDate || dateStr === tempEndDate;
  };

  const isDateInRange = (dateStr: string): boolean => {
    if (!tempStartDate || !tempEndDate) return false;
    const date = parseLocalDate(dateStr);
    const start = parseLocalDate(tempStartDate);
    const end = parseLocalDate(tempEndDate);
    return date > start && date < end;
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(currentMonth);
    const firstDay = getFirstDayOfMonth(currentMonth);
    const days: (number | null)[] = [];
    const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];

    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }

    const todayStr = formatLocalDate(new Date());

    return (
      <VStack space='md' w='$full'>
        {/* Month Navigation */}
        <HStack justifyContent='space-between' alignItems='center' px='$1'>
          <Pressable
            onPress={() => navigateMonth('prev')}
            p='$2'
            borderRadius='$full'
            $active-bg='$backgroundLight200'
          >
            <Icon as={ChevronLeft} size='md' color='$textLight700' />
          </Pressable>
          <Text size='md' fontWeight='$bold' color='$textLight900'>
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </Text>
          <Pressable
            onPress={() => navigateMonth('next')}
            p='$2'
            borderRadius='$full'
            $active-bg='$backgroundLight200'
          >
            <Icon as={ChevronRight} size='md' color='$textLight700' />
          </Pressable>
        </HStack>

        {/* Week Days Header */}
        <HStack justifyContent='space-around'>
          {weekDays.map((day) => (
            <Box key={day} w='$9' alignItems='center'>
              <Text size='xs' fontWeight='$semibold' color='$textLight500'>
                {day}
              </Text>
            </Box>
          ))}
        </HStack>

        {/* Calendar Grid */}
        <VStack space='xs'>
          {Array.from({ length: Math.ceil(days.length / 7) }).map(
            (_, weekIndex) => (
              <HStack key={weekIndex} space='xs' justifyContent='space-around'>
                {Array.from({ length: 7 }).map((_, dayIndex) => {
                  const day = days[weekIndex * 7 + dayIndex];
                  if (day === null || day === undefined) {
                    return <Box key={dayIndex} w='$9' h='$9' />;
                  }

                  const date = new Date(
                    currentMonth.getFullYear(),
                    currentMonth.getMonth(),
                    day
                  );
                  const dateStr = formatLocalDate(date);
                  const isSelected = isDateSelected(dateStr);
                  const inRange = isDateInRange(dateStr);
                  const isToday = dateStr === todayStr;
                  const isStart = dateStr === tempStartDate;
                  const isEnd = dateStr === tempEndDate;

                  return (
                    <Pressable
                      key={dayIndex}
                      onPress={() => handleDateSelect(date)}
                    >
                      <Box
                        w='$9'
                        h='$9'
                        borderRadius='$full'
                        alignItems='center'
                        justifyContent='center'
                        bg={
                          isStart || isEnd
                            ? '$primary500'
                            : inRange
                              ? '$primary100'
                              : 'transparent'
                        }
                        borderWidth={isToday && !isSelected ? 1 : 0}
                        borderColor='$primary500'
                      >
                        <Text
                          size='sm'
                          fontWeight={isStart || isEnd ? '$bold' : isToday ? '$semibold' : '$normal'}
                          color={
                            isStart || isEnd
                              ? '$white'
                              : inRange
                                ? '$primary700'
                                : '$textLight900'
                          }
                        >
                          {day}
                        </Text>
                      </Box>
                    </Pressable>
                  );
                })}
              </HStack>
            )
          )}
        </VStack>
      </VStack>
    );
  };

  const calculatedDays =
    tempStartDate && tempEndDate
      ? Math.ceil(
          (parseLocalDate(tempEndDate).getTime() -
            parseLocalDate(tempStartDate).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1
      : tempStartDate
        ? 1
        : 0;

  return (
    <>
      {/* Touchable Input Trigger */}
      <Pressable onPress={handleOpen} w='$full'>
        <Box
          flexDirection='row'
          alignItems='center'
          bg='$white'
          h={50}
          px='$3.5'
          borderRadius='$xl'
          borderWidth={1}
          borderColor='$borderLight300'
          justifyContent='space-between'
        >
          <HStack space='sm' alignItems='center' flex={1}>
            <Icon as={Calendar} size='md' color='$primary500' />
            <Text
              size='sm'
              color={startDate ? '$textLight900' : '$textLight400'}
              fontWeight={startDate ? '$medium' : '$normal'}
            >
              {formatDateRange() || 'Seleccionar fechas del viaje'}
            </Text>
          </HStack>
          {startDate ? (
            <Box bg='$primary50' px='$2.5' py='$1' borderRadius='$full'>
              <Text size='2xs' fontWeight='$bold' color='$primary600'>
                {days} {days === 1 ? 'DÍA' : 'DÍAS'}
              </Text>
            </Box>
          ) : null}
        </Box>
      </Pressable>

      <Actionsheet isOpen={isOpen} onClose={handleClose} snapPoints={[85]}>
        <ActionsheetBackdrop />
        <ActionsheetContent maxHeight='$full' bg='$white'>
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>
          <Box w='$full' p='$4'>
            <ScrollView
              w='$full'
              contentContainerStyle={{ paddingBottom: 20 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps='always'
            >
              <VStack space='md' w='$full'>
                <HStack justifyContent='space-between' alignItems='center'>
                  <Text size='lg' fontWeight='$bold' color='$textLight900'>
                    Fechas del Viaje
                  </Text>
                  {calculatedDays > 0 && (
                    <Box bg='$primary50' px='$3' py='$1' borderRadius='$full'>
                      <Text size='xs' fontWeight='$bold' color='$primary600'>
                        {calculatedDays} {calculatedDays === 1 ? 'Día' : 'Días'}
                      </Text>
                    </Box>
                  )}
                </HStack>

                {/* Quick Preset Chips */}
                <HStack space='xs' flexWrap='wrap'>
                  {[
                    { label: '1 Día', days: 1 },
                    { label: 'Fin de Semana (2d)', days: 2 },
                    { label: '3 Días', days: 3 },
                    { label: '1 Semana (7d)', days: 7 },
                  ].map((preset) => (
                    <Pressable
                      key={preset.label}
                      onPress={() => handlePreset(preset.days)}
                      bg='$backgroundLight100'
                      px='$3'
                      py='$1.5'
                      borderRadius='$full'
                      borderWidth={1}
                      borderColor='$borderLight200'
                      $active-bg='$primary50'
                    >
                      <Text size='xs' color='$textLight800' fontWeight='$medium'>
                        {preset.label}
                      </Text>
                    </Pressable>
                  ))}
                </HStack>

                {/* Mode Selector */}
                <HStack space='sm' mt='$1'>
                  <Pressable
                    flex={1}
                    onPress={() => setSelectionMode('start')}
                    p='$2.5'
                    borderRadius='$xl'
                    borderWidth={1}
                    borderColor={selectionMode === 'start' ? '$primary500' : '$borderLight200'}
                    bg={selectionMode === 'start' ? '$primary50' : '$white'}
                    alignItems='center'
                  >
                    <Text size='2xs' color='$textLight500' textTransform='uppercase' fontWeight='$bold'>
                      Inicio
                    </Text>
                    <Text size='sm' fontWeight='$bold' color={tempStartDate ? '$textLight900' : '$textLight400'}>
                      {tempStartDate ? formatDateLabel(tempStartDate) : 'Elegir fecha'}
                    </Text>
                  </Pressable>

                  <Pressable
                    flex={1}
                    onPress={() => setSelectionMode('end')}
                    p='$2.5'
                    borderRadius='$xl'
                    borderWidth={1}
                    borderColor={selectionMode === 'end' ? '$primary500' : '$borderLight200'}
                    bg={selectionMode === 'end' ? '$primary50' : '$white'}
                    alignItems='center'
                  >
                    <Text size='2xs' color='$textLight500' textTransform='uppercase' fontWeight='$bold'>
                      Fin
                    </Text>
                    <Text size='sm' fontWeight='$bold' color={tempEndDate ? '$textLight900' : '$textLight400'}>
                      {tempEndDate ? formatDateLabel(tempEndDate) : 'Elegir fecha'}
                    </Text>
                  </Pressable>
                </HStack>

                {/* Calendar */}
                {renderCalendar()}

                {/* Actions */}
                <HStack space='sm' mt='$2'>
                  <Button
                    variant='outline'
                    borderColor='$borderLight300'
                    borderRadius='$xl'
                    flex={1}
                    onPress={handleClear}
                  >
                    <ButtonText color='$textLight700' size='sm'>
                      Limpiar
                    </ButtonText>
                  </Button>
                  <Button
                    bg='$primary500'
                    borderRadius='$xl'
                    flex={2}
                    onPress={handleConfirm}
                    isDisabled={!tempStartDate}
                  >
                    <ButtonText size='sm' fontWeight='$bold'>
                      Confirmar Fechas
                    </ButtonText>
                  </Button>
                </HStack>
              </VStack>
            </ScrollView>
          </Box>
        </ActionsheetContent>
      </Actionsheet>
    </>
  );
};
