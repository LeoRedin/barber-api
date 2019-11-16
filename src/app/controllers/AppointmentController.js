import * as Yup from 'yup';
import { startOfHour, parseISO, isBefore, format, subHours } from 'date-fns';
import pt from 'date-fns/locale/pt-BR';
import User from '../models/User';
import File from '../models/File';
import Appointment from '../models/Appointment';
import Notification from '../schemas/Notification';

import CancellationMail from '../jobs/CancellationMail';
import Queue from '../../lib/Queue';

class AppointmentController {
  async index(req, res) {
    const { page = 1 } = req.query;

    const appointments = await Appointment.findAll({
      where: { user_id: req.userId, canceled_at: null },
      order: ['date'],
      limit: 20,
      offset: (page - 1) * 20,
      attributes: ['id', 'date', 'past', 'cancelable'],
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['id', 'name'],
          include: [
            { model: File, as: 'avatar', attributes: ['id', 'path', 'url'] },
          ],
        },
      ],
    });

    return res.json({ appointments });
  }

  async store(req, res) {
    const schema = Yup.object().shape({
      provider_id: Yup.number().required(),
      date: Yup.date().required(),
    });

    /**
     * Valida dados enviados
     */
    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({
        error: 'Dados inválidos',
      });
    }

    const { provider_id, date } = req.body;

    /**
     * Valida se provider_id é provider
     */
    const isProvider = await User.findOne({
      where: { id: provider_id, provider: true },
    });

    if (!isProvider) {
      return res.status(401).json({
        error: 'Tentando fazer agendamento com usuário comum',
      });
    }

    /**
     * Verifica se está agendando para sim mesmo
     */
    if (provider_id === req.userId) {
      return res.status(400).json({
        error: 'Não é permitido fazer agendamento para si mesmo',
      });
    }

    /**
     * Verifica datas passadas
     */
    const hourStart = startOfHour(parseISO(date));

    if (isBefore(hourStart, new Date())) {
      return res.status(400).json({
        error: 'Não é permitido o agendamento de horas passadas',
      });
    }

    /**
     * Verifica data disponível
     */
    const dateNotAvailable = await Appointment.findOne({
      where: {
        provider_id,
        canceled_at: null,
        date: hourStart,
      },
    });

    if (dateNotAvailable) {
      return res.status(400).json({
        error: 'Data não está disponível para agendamento',
      });
    }

    const appointment = await Appointment.create({
      user_id: req.userId,
      provider_id,
      date,
    });

    /**
     * Notificar barbeiro sobre novo agendamento
     */
    const { name } = await User.findByPk(req.userId);
    const formattedDate = format(hourStart, "'dia' dd 'de' MMMM' às' H:mm", {
      locale: pt,
    });

    await Notification.create({
      content: `Novo agendamento de ${name} para ${formattedDate}`,
      user: provider_id,
    });

    // console.log(`Novo agendamento de ${name} para ${formattedDate}`);

    return res.json({ appointment });
  }

  async delete(req, res) {
    const appointment = await Appointment.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['name', 'email'],
        },
        {
          model: User,
          as: 'user',
          attributes: ['name'],
        },
      ],
    });

    if (appointment.user_id !== req.userId) {
      return res.status(401).json({
        error: 'Operação não permitida',
      });
    }

    const dateWithSub = subHours(appointment.date, 2);

    if (isBefore(dateWithSub, new Date())) {
      return res.status(401).json({
        error:
          'Só podem ser cancelados agendamentos com 2 horas de antecedência',
      });
    }

    appointment.canceled_at = new Date();

    await appointment.save();

    await Queue.add(CancellationMail.key, { appointment });

    return res.json({ appointment });
  }
}

export default new AppointmentController();
