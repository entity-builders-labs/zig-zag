import React, { useState } from 'react';
import {
  Box,
  Input,
  InputField,
  InputIcon,
  InputSlot,
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
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react-native';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  days: number;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onDaysChange: (days: number) => void;
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
    startDate ? new Date(startDate) : new Date()
  );
  const [selectionMode, setSelectionMode] = useState<'start' | 'end'>('start');

  const formatDate = (dateString: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
    });
  };

  const formatDateRange = (): string => {
    if (!startDate && !endDate) return '';
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    if (start && end) {
      const daysDiff =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
      const startStr = formatDate(startDate);
      const endStr = formatDate(endDate);
      return `${startStr} - ${endStr} (${daysDiff} Días)`;
    } else if (start) {
      const startStr = formatDate(startDate);
      return `${startStr} - ${startStr} (1 Día)`;
    }
    return '';
  };

  const handleOpen = () => {
    setTempStartDate(startDate);
    setTempEndDate(endDate);
    setCurrentMonth(
      startDate ? new Date(startDate) : endDate ? new Date(endDate) : new Date()
    );
    setSelectionMode(startDate && endDate ? 'start' : 'start');
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

  const handleConfirm = () => {
    if (tempStartDate) onStartDateChange(tempStartDate);
    if (tempEndDate) onEndDateChange(tempEndDate);
    if (tempStartDate && tempEndDate) {
      const start = new Date(tempStartDate);
      const end = new Date(tempEndDate);
      const daysDiff =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;
      onDaysChange(daysDiff);
    }
    setIsOpen(false);
  };

  const handleDateSelect = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];

    if (selectionMode === 'start') {
      setTempStartDate(dateStr);
      if (tempEndDate) {
        // Si hay fecha fin y la nueva inicio es posterior, limpiamos fin
        if (new Date(dateStr) > new Date(tempEndDate)) {
          setTempEndDate('');
        }
      }
      setSelectionMode('end'); // Automáticamente pasar a seleccionar fin
    } else {
      // Modo fin
      if (tempStartDate && new Date(dateStr) < new Date(tempStartDate)) {
        // Si la fecha seleccionada es anterior a inicio, la hacemos inicio
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

  const isDateSelected = (day: number): boolean => {
    const date = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    );
    const dateStr = date.toISOString().split('T')[0];
    return dateStr === tempStartDate || dateStr === tempEndDate;
  };

  const isDateInRange = (day: number): boolean => {
    if (!tempStartDate || !tempEndDate) return false;
    const date = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    );
    const start = new Date(tempStartDate);
    const end = new Date(tempEndDate);
    return date >= start && date <= end;
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(currentMonth);
    const firstDay = getFirstDayOfMonth(currentMonth);
    const days: (number | null)[] = [];
    const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];

    // Días vacíos al inicio
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    // Días del mes
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }

    return (
      <VStack space='md' w='$full'>
        {/* Month Navigation */}
        <HStack justifyContent='space-between' alignItems='center' px='$2'>
          <Pressable onPress={() => navigateMonth('prev')}>
            <Box p='$2'>
              <Icon as={ChevronLeft} size='md' color='$textLight600' />
            </Box>
          </Pressable>
          <Text size='lg' fontWeight='$bold' color='$textLight900'>
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </Text>
          <Pressable onPress={() => navigateMonth('next')}>
            <Box p='$2'>
              <Icon as={ChevronRight} size='md' color='$textLight600' />
            </Box>
          </Pressable>
        </HStack>

        {/* Week Days Header */}
        <HStack space='xs' justifyContent='space-around'>
          {weekDays.map((day) => (
            <Box key={day} w='$12' alignItems='center'>
              <Text size='xs' fontWeight='$semibold' color='$textLight600'>
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
                    return <Box key={dayIndex} w='$12' h='$12' />;
                  }

                  const date = new Date(
                    currentMonth.getFullYear(),
                    currentMonth.getMonth(),
                    day
                  );
                  const dateStr = date.toISOString().split('T')[0];
                  const isSelected = isDateSelected(day);
                  const inRange = isDateInRange(day);
                  const isToday =
                    dateStr === new Date().toISOString().split('T')[0];
                  const isStart = dateStr === tempStartDate;
                  const isEnd = dateStr === tempEndDate;

                  return (
                    <Pressable
                      key={dayIndex}
                      onPress={() => handleDateSelect(date)}
                    >
                      <Box
                        w='$12'
                        h='$12'
                        borderRadius='$md'
                        alignItems='center'
                        justifyContent='center'
                        bg={
                          isStart || isEnd
                            ? '$primary500'
                            : inRange
                              ? '$primary50'
                              : 'transparent'
                        }
                        borderWidth={isToday ? '$1' : '$0'}
                        borderColor='$primary500'
                      >
                        <Text
                          size='sm'
                          fontWeight={isStart || isEnd ? '$bold' : '$normal'}
                          color={
                            isStart || isEnd
                              ? '$white'
                              : inRange
                                ? '$primary500'
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

  return (
    <>
      <Pressable onPress={handleOpen}>
        <Input variant='outline' size='lg' isReadOnly>
          <InputSlot pl='$3'>
            <InputIcon as={Calendar} size='md' color='$textLight600' />
          </InputSlot>
          <InputField
            placeholder='Seleccionar fechas'
            value={formatDateRange()}
            editable={false}
          />
        </Input>
      </Pressable>

      <Actionsheet isOpen={isOpen} onClose={handleClose} snapPoints={[85]}>
        <ActionsheetBackdrop />
        <ActionsheetContent maxHeight='$full'>
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>
          <Box w='$full' h='$full'>
            <ScrollView
              w='$full'
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            >
              <VStack space='lg' p='$4' w='$full'>
                <Text size='lg' fontWeight='$bold' color='$textLight900'>
                  Seleccionar Fechas
                </Text>

                {/* Mode Selection Buttons */}
                <HStack space='md' mb='$2'>
                  <Button
                    variant={selectionMode === 'start' ? 'solid' : 'outline'}
                    flex={1}
                    onPress={() => setSelectionMode('start')}
                    borderColor={
                      selectionMode === 'start'
                        ? '$primary500'
                        : '$textLight300'
                    }
                  >
                    <ButtonText
                      color={
                        selectionMode === 'start' ? '$white' : '$textLight600'
                      }
                    >
                      Fecha Inicio
                    </ButtonText>
                  </Button>
                  <Button
                    variant={selectionMode === 'end' ? 'solid' : 'outline'}
                    flex={1}
                    onPress={() => setSelectionMode('end')}
                    borderColor={
                      selectionMode === 'end' ? '$primary500' : '$textLight300'
                    }
                    isDisabled={!tempStartDate}
                  >
                    <ButtonText
                      color={
                        selectionMode === 'end' ? '$white' : '$textLight600'
                      }
                    >
                      Fecha Fin
                    </ButtonText>
                  </Button>
                </HStack>

                {/* Calendar */}
                {renderCalendar()}

                {/* Selection Status */}
                <HStack space='md' justifyContent='space-around'>
                  <VStack alignItems='center' flex={1}>
                    <Text size='xs' color='$textLight600' mb='$1'>
                      Fecha Inicio
                    </Text>
                    <Text
                      size='sm'
                      fontWeight='$semibold'
                      color={tempStartDate ? '$primary500' : '$textLight400'}
                    >
                      {tempStartDate
                        ? formatDate(tempStartDate)
                        : 'No seleccionada'}
                    </Text>
                  </VStack>
                  <VStack alignItems='center' flex={1}>
                    <Text size='xs' color='$textLight600' mb='$1'>
                      Fecha Fin
                    </Text>
                    <Text
                      size='sm'
                      fontWeight='$semibold'
                      color={tempEndDate ? '$primary500' : '$textLight400'}
                    >
                      {tempEndDate
                        ? formatDate(tempEndDate)
                        : 'No seleccionada'}
                    </Text>
                  </VStack>
                  <VStack alignItems='center' flex={1}>
                    <Text size='xs' color='$textLight600' mb='$1'>
                      Duración
                    </Text>
                    <Text
                      size='sm'
                      fontWeight='$semibold'
                      color={
                        tempStartDate && tempEndDate
                          ? '$primary500'
                          : '$textLight400'
                      }
                    >
                      {tempStartDate && tempEndDate
                        ? `${
                            Math.ceil(
                              (new Date(tempEndDate).getTime() -
                                new Date(tempStartDate).getTime()) /
                                (1000 * 60 * 60 * 24)
                            ) + 1
                          } Días`
                        : '-'}
                    </Text>
                  </VStack>
                </HStack>

                {/* Action Buttons */}
                <HStack space='md' mt='$2' mb='$8'>
                  <Button variant='outline' flex={1} onPress={handleClear}>
                    <ButtonText color='$error500'>Limpiar</ButtonText>
                  </Button>
                  <Button
                    flex={1}
                    onPress={handleConfirm}
                    isDisabled={!tempStartDate || !tempEndDate}
                  >
                    <ButtonText>Confirmar</ButtonText>
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
